// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {OpenFourToken} from "./OpenFourToken.sol";
import {OpenFourTypes} from "../libraries/OpenFourTypes.sol";
import {IUniTokenRenderer} from "../interfaces/IUniTokenRenderer.sol";
import {IRandomSeedProvider} from "../interfaces/iv4/IV4Core.sol";

/// @title UniToken
/// @notice ERC20 token that binds on-chain "Art" collectibles to token balance.
///
/// Rules:
///   UNIT_PER_ART = 100_000e18 tokens entitle the holder to one Art piece.
///   Inner market (bonding curve via OpenFour vault):
///     - Buy  (vault mint → user)    : _syncUp   → mint new Art to buyer
///     - Sell (user transfer → vault): _syncDown  → burn excess Art from seller
///   Outer market (PancakeSwap V4, identified by migratedPools):
///     - Buy  (pool → user): _syncUp  → mint new Art
///     - Sell (user → pool): _syncDown → burn excess Art
///   User-to-user transfer: _syncUserToUser →
///     physically moves existing Art from sender to receiver first (ID + seed preserved),
///     burns any remaining excess from sender; no new mints for receiver's leftover capacity.
///
///   Reverse binding:
///     transferArt / transferArtsList — moving an Art piece also triggers ERC20 _transfer.
///
///   Art appearance is determined by a uint256 seed stored per piece.
///   Seed source:
///     - Outer market: reads IRandomSeedProvider on the V4 hook (updated each swap).
///     - Inner market: derived from block entropy (prevrandao + timestamp + nonce).
///
///   Visual rendering is delegated to an external IUniTokenRenderer.
///   If none is configured, artTokenURI() returns an empty string.
contract UniToken is OpenFourToken {

    // ─── Constants ────────────────────────────────────────────────────────────
    /// @notice Token amount required to back one Art piece.
    uint256 public constant UNIT_PER_ART = 100_000e18;

    // ─── Art storage ──────────────────────────────────────────────────────────
    /// @dev Monotonic Art id counter; burned ids are not reused.
    uint256 private _artTotalCount;

    mapping(uint256 => uint256) private _artSeeds;                           // artId  → seed
    mapping(address => uint256) private _artCounts;                          // owner  → art count
    mapping(address => mapping(uint256 => uint256)) private _ownedArts;     // owner  → index → artId
    mapping(address => mapping(uint256 => uint256)) private _ownedArtIndex; // owner  → artId → index
    mapping(uint256 => address) private _artOwner;                           // artId  → owner

    // ─── Holder list (1-based; 0 = not a holder) ─────────────────────────────
    mapping(uint256 => address) private _holderList;        // 1-based index → holder
    mapping(address => uint256) private _holderListNumbers; // holder → 1-based index (0 = not holder)
    uint256 private _holdersCount;

    // ─── Configurable addresses ───────────────────────────────────────────────
    /// @notice External renderer; address(0) means artTokenURI() returns "".
    IUniTokenRenderer public renderer;
    /// @notice V4 hook (IRandomSeedProvider); drives outer-market Art randomness.
    address public v4Hook;

    // ─── Inner-market seed nonce ──────────────────────────────────────────────
    uint256 private _innerNonce;

    // ─── Events ───────────────────────────────────────────────────────────────
    event ArtMinted(address indexed owner, uint256 indexed artId, uint256 seed);
    event ArtBurned(address indexed owner, uint256 indexed artId);
    event ArtTransferred(address indexed from, address indexed to, uint256 indexed artId);

    // ─── Initialization ───────────────────────────────────────────────────────

    /// @notice Initializes the token clone and optional Art renderer / V4 hook.
    /// @dev tokenParams = abi.encode(address renderer_, address v4Hook_)
    function initialize(InitArgs calldata c) external override initializer {
        __OpenFourToken_init(c);
        if (c.tokenParams.length >= 64) {
            (address renderer_, address v4Hook_) = abi.decode(c.tokenParams, (address, address));
            renderer = IUniTokenRenderer(renderer_);
            v4Hook   = v4Hook_;
        }
    }

    function _descriptorTag() internal pure override returns (string memory) {
        return "token.uni";
    }

    // ─── Art view functions ───────────────────────────────────────────────────

    /// @notice Returns the total number of Art pieces ever minted.
    function artTotalCount() external view returns (uint256) { return _artTotalCount; }
    /// @notice Returns the current Art count owned by an address.
    function artCountOf(address owner) external view returns (uint256) { return _artCounts[owner]; }

    /// @notice Returns the Art id owned by `owner` at `index`.
    function artIdOf(address owner, uint256 index) external view returns (uint256) {
        require(index < _artCounts[owner], "UniToken: index OOB");
        return _ownedArts[owner][index];
    }

    /// @notice Returns the rendering seed for an Art piece.
    function artSeedOf(uint256 artId) external view returns (uint256) {
        require(_artOwner[artId] != address(0), "UniToken: art not found");
        return _artSeeds[artId];
    }

    /// @notice Returns the current owner of an Art piece.
    function artOwnerOf(uint256 artId) external view returns (address) {
        require(_artOwner[artId] != address(0), "UniToken: art not found");
        return _artOwner[artId];
    }

    /// @notice Returns tokenURI for an Art piece via the configured renderer.
    function artTokenURI(uint256 artId) external view returns (string memory) {
        require(_artOwner[artId] != address(0), "UniToken: art not found");
        if (address(renderer) == address(0)) return "";
        return renderer.tokenURI(artId, _artSeeds[artId]);
    }

    /// @notice Paginated art query for a given owner. Returns (ids, seeds).
    function artsOf(address owner, uint256 offset, uint256 limit)
        external view
        returns (uint256[] memory ids, uint256[] memory seeds)
    {
        uint256 total = _artCounts[owner];
        if (offset >= total || limit == 0) return (new uint256[](0), new uint256[](0));
        uint256 end = offset + limit > total ? total : offset + limit;
        uint256 len = end - offset;
        ids   = new uint256[](len);
        seeds = new uint256[](len);
        for (uint256 i; i < len; ++i) {
            uint256 id = _ownedArts[owner][offset + i];
            ids[i]   = id;
            seeds[i] = _artSeeds[id];
        }
    }

    // ─── Holder list view functions ───────────────────────────────────────────

    /// @notice Returns whether an address is currently in the Art holder list.
    function isHolder(address owner) public view returns (bool) {
        return _holderListNumbers[owner] > 0;
    }

    /// @notice Returns the number of addresses currently holding at least one Art piece.
    function holdersCount() external view returns (uint256) { return _holdersCount; }

    /// @notice Returns the holder at the given 1-based index.
    function holderAt(uint256 index) external view returns (address) {
        require(index > 0 && index <= _holdersCount, "UniToken: holder index OOB");
        return _holderList[index];
    }

    /// @notice Returns the 1-based holder-list number for an address (0 = not a holder).
    function holderNumber(address owner) external view returns (uint256) {
        return _holderListNumbers[owner];
    }

    // ─── Reorder functions ────────────────────────────────────────────────────

    /// @notice Shifts artId to newIndex, displacing elements in between. O(n).
    function reorderArt(uint256 artId, uint256 newIndex) external {
        address caller = msg.sender;
        require(_artOwner[artId] == caller,          "UniToken: not art owner");
        require(newIndex < _artCounts[caller],        "UniToken: index OOB");

        uint256 currentIndex = _ownedArtIndex[caller][artId];
        if (currentIndex == newIndex) return;

        if (newIndex < currentIndex) {
            // shift right: elements [newIndex .. currentIndex-1] move to +1
            for (uint256 i = currentIndex; i > newIndex; --i) {
                uint256 shifted = _ownedArts[caller][i - 1];
                _ownedArts[caller][i]         = shifted;
                _ownedArtIndex[caller][shifted] = i;
            }
        } else {
            // shift left: elements [currentIndex+1 .. newIndex] move to -1
            for (uint256 i = currentIndex; i < newIndex; ++i) {
                uint256 shifted = _ownedArts[caller][i + 1];
                _ownedArts[caller][i]         = shifted;
                _ownedArtIndex[caller][shifted] = i;
            }
        }

        _ownedArts[caller][newIndex]    = artId;
        _ownedArtIndex[caller][artId]   = newIndex;
    }

    /// @notice Swaps artId with the element at newIndex. O(1).
    function reorderArtPair(uint256 artId, uint256 newIndex) external {
        address caller = msg.sender;
        require(_artOwner[artId] == caller,    "UniToken: not art owner");
        require(newIndex < _artCounts[caller], "UniToken: index OOB");

        uint256 currentIndex = _ownedArtIndex[caller][artId];
        if (currentIndex == newIndex) return;

        uint256 otherId = _ownedArts[caller][newIndex];

        _ownedArts[caller][newIndex]      = artId;
        _ownedArts[caller][currentIndex]  = otherId;
        _ownedArtIndex[caller][artId]     = newIndex;
        _ownedArtIndex[caller][otherId]   = currentIndex;
    }

    // ─── Transfer hook ────────────────────────────────────────────────────────

    function _afterTokenTransfer(address from, address to, uint256 amount) internal override {
        super._afterTokenTransfer(from, to, amount);

        if (amount == 0) return;

        // vault burns its own balance after a sell; sender's art already handled
        // in the prior user→vault leg, so skip this zero-address burn.
        if (from == vault && to == address(0)) return;

        // ── Inner market: zero → vault (pre-mint at initialization) ─────────
        if (from == address(0)) {
            if (to != address(0) && to != vault && !migratedPools[to]) {
                _syncUp(to, _resolveSeed(from, to));
            }
            return;
        }

        // ── Inner market: vault → user (bonding curve buy, pre-mint model) ───
        if (from == vault) {
            if (tokenPhase == OpenFourTypes.Phase.Trading && to != address(0) && !migratedPools[to]) {
                _syncUp(to, _resolveSeed(from, to));
            }
            return;
        }

        // ── Inner market: user → vault (bonding curve sell) ──────────────────
        if (to == vault) {
            _syncDown(from);
            return;
        }

        // ── Outer market: pool → user (external buy) ─────────────────────────
        if (migratedPools[from]) {
            if (to != address(0) && !migratedPools[to]) {
                _syncUp(to, _resolveSeed(from, to));
            }
            return;
        }

        // ── Outer market: user → pool (external sell) ────────────────────────
        if (migratedPools[to]) {
            _syncDown(from);
            return;
        }

        // ── User-to-user: physically transfer Art, burn remainder ─────────────
        _syncUserToUser(from, to);
    }

    // ─── Reverse binding: Art transfer triggers ERC20 transfer ───────────────

    /// @notice Transfer one Art piece to `to`. Moves UNIT_PER_ART tokens automatically.
    ///         Art identity (ID + seed) is preserved.
    function transferArt(address to, uint256 artId) external {
        require(to != address(0),               "UniToken: zero to");
        require(!migratedPools[to],             "UniToken: to is a pool");
        require(_artOwner[artId] == msg.sender, "UniToken: not art owner");

        // Move art BEFORE token transfer; _afterTokenTransfer will see counts in sync.
        _moveArt(msg.sender, to, artId);
        _transfer(msg.sender, to, UNIT_PER_ART);
    }

    /// @notice Transfer multiple Art pieces to `to` in one call.
    function transferArtsList(address to, uint256[] calldata artIds) external {
        require(to != address(0),   "UniToken: zero to");
        require(!migratedPools[to], "UniToken: to is a pool");
        uint256 n = artIds.length;
        require(n > 0, "UniToken: empty list");

        for (uint256 i; i < n; ++i) {
            require(_artOwner[artIds[i]] == msg.sender, "UniToken: not art owner");
            _moveArt(msg.sender, to, artIds[i]);
        }
        _transfer(msg.sender, to, UNIT_PER_ART * n);
    }

    // ─── Art sync helpers ─────────────────────────────────────────────────────

    /// @dev Mints Art until holder's count matches balance tier.
    ///      Capped at 50 per call to prevent single-tx gas exhaustion.
    function _syncUp(address user, uint256 baseSeed) private {
        uint256 target  = balanceOf(user) / UNIT_PER_ART;
        uint256 current = _artCounts[user];
        if (target <= current) return;
        if (target > current + 50) target = current + 50;
        for (uint256 i = current; i < target; ++i) {
            _mintArt(user, uint256(keccak256(abi.encodePacked(baseSeed, i))));
        }
    }

    /// @dev Burns Art from the tail until count matches balance tier.
    function _syncDown(address user) private {
        uint256 target  = balanceOf(user) / UNIT_PER_ART;
        uint256 current = _artCounts[user];
        for (uint256 i = current; i > target; --i) {
            _burnLastArt(user);
        }
    }

    /// @dev User-to-user: physically move Art first, then burn sender's excess.
    ///      Receiver's unfilled capacity is NOT minted (Art only created on buys).
    function _syncUserToUser(address from, address to) private {
        uint256 fromTarget  = balanceOf(from) / UNIT_PER_ART;
        uint256 fromCurrent = _artCounts[from];
        if (fromCurrent <= fromTarget) return;

        uint256 fromExcess = fromCurrent - fromTarget;
        uint256 toTarget   = balanceOf(to)   / UNIT_PER_ART;
        uint256 toCurrent  = _artCounts[to];
        uint256 toCapacity = toTarget > toCurrent ? toTarget - toCurrent : 0;

        uint256 moveQty = fromExcess < toCapacity ? fromExcess : toCapacity;
        for (uint256 i; i < moveQty; ++i) {
            uint256 artId = _ownedArts[from][_artCounts[from] - 1];
            _moveArt(from, to, artId);
        }

        uint256 burnQty = fromExcess - moveQty;
        for (uint256 i; i < burnQty; ++i) {
            _burnLastArt(from);
        }
    }

    // ─── Art atomic operations ────────────────────────────────────────────────

    function _mintArt(address owner, uint256 seed) private {
        uint256 id              = ++_artTotalCount;
        _artSeeds[id]           = seed;
        _artOwner[id]           = owner;
        uint256 idx             = _artCounts[owner];
        _ownedArts[owner][idx]      = id;
        _ownedArtIndex[owner][id]   = idx;
        _artCounts[owner]++;
        _addHolder(owner);
        emit ArtMinted(owner, id, seed);
    }

    /// @dev O(1) art transfer using swap-with-last on sender's enumerable list.
    function _moveArt(address from, address to, uint256 artId) private {
        uint256 fromLastIdx = _artCounts[from] - 1;
        uint256 artIdx      = _ownedArtIndex[from][artId];

        if (artIdx != fromLastIdx) {
            uint256 lastId = _ownedArts[from][fromLastIdx];
            _ownedArts[from][artIdx]      = lastId;
            _ownedArtIndex[from][lastId]  = artIdx;
        }
        delete _ownedArts[from][fromLastIdx];
        delete _ownedArtIndex[from][artId];
        _artCounts[from]--;
        if (_artCounts[from] == 0) _removeHolder(from);

        uint256 toIdx = _artCounts[to];
        _ownedArts[to][toIdx]      = artId;
        _ownedArtIndex[to][artId]  = toIdx;
        _artCounts[to]++;
        _artOwner[artId] = to;
        _addHolder(to);

        emit ArtTransferred(from, to, artId);
    }

    function _burnLastArt(address owner) private {
        uint256 count = _artCounts[owner];
        if (count == 0) return;
        uint256 lastIdx = count - 1;
        uint256 id      = _ownedArts[owner][lastIdx];
        delete _ownedArts[owner][lastIdx];
        delete _ownedArtIndex[owner][id];
        delete _artSeeds[id];
        delete _artOwner[id];
        _artCounts[owner]--;
        if (_artCounts[owner] == 0) _removeHolder(owner);
        emit ArtBurned(owner, id);
    }

    // ─── Holder list management ───────────────────────────────────────────────

    /// @dev Adds owner to holder list (1-based index) if not already present.
    function _addHolder(address owner) private {
        if (_holderListNumbers[owner] == 0) {
            ++_holdersCount;
            _holderList[_holdersCount]      = owner;
            _holderListNumbers[owner]       = _holdersCount;
        }
    }

    /// @dev Removes owner from holder list using swap-with-last to keep list compact.
    function _removeHolder(address owner) private {
        uint256 num = _holderListNumbers[owner];
        if (num == 0) return;

        address lastHolder = _holderList[_holdersCount];
        _holderList[num]                    = lastHolder;
        _holderListNumbers[lastHolder]      = num;
        delete _holderList[_holdersCount];
        delete _holderListNumbers[owner];
        _holdersCount--;
    }

    // ─── Seed resolution ──────────────────────────────────────────────────────

    /// @dev Outer-market: reads V4 hook's randomSeed (updated per swap).
    ///      Inner-market: derives entropy from block data + incrementing nonce.
    function _resolveSeed(address from, address to) private returns (uint256) {
        if (v4Hook != address(0) && (migratedPools[from] || migratedPools[to])) {
            return IRandomSeedProvider(v4Hook).randomSeed();
        }
        return uint256(keccak256(abi.encodePacked(
            block.prevrandao,
            block.timestamp,
            block.number,
            ++_innerNonce,
            from,
            to
        )));
    }
}
