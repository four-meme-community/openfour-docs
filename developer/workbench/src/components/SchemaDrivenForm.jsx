import { useT } from '../i18n'

export function SchemaDrivenForm({ params, formData, onChange }) {
  const t = useT()
  function update(key, value) {
    onChange({ ...formData, [key]: value })
  }

  return (
    <>
      {params.map((desc) => {
        const label = desc.title || desc.name
        const value = formData[desc.name]

        if (desc.abiType === 'bool') {
          return (
            <label key={desc.name} className="checkbox-row schema-field">
              <input
                type="checkbox"
                checked={typeof value === 'boolean' ? value : String(value) === 'true'}
                onChange={(e) => update(desc.name, e.target.checked)}
              />
              {label}
              {desc.hint && <span className="field-help">{desc.hint}</span>}
            </label>
          )
        }

        if (desc.abiType.endsWith('[]')) {
          const strVal = Array.isArray(value) ? value.join('\n') : (value == null ? '' : String(value))
          return (
            <label key={desc.name} className="schema-field">
              {label}{!desc.optional && ' *'}
              <textarea
                value={strVal}
                placeholder={desc.defaultValue || t('schema.arrayPlaceholder')}
                required={!desc.optional}
                rows={3}
                onChange={(e) => update(desc.name, e.target.value)}
              />
              {desc.hint && <span className="field-help">{desc.hint}</span>}
            </label>
          )
        }

        const strVal = value == null ? '' : String(value)
        return (
          <label key={desc.name} className="schema-field">
            {label}{!desc.optional && ' *'}
            <input
              type="text"
              value={strVal}
              placeholder={desc.defaultValue || undefined}
              required={!desc.optional}
              onChange={(e) => update(desc.name, e.target.value)}
            />
            {desc.hint && <span className="field-help">{desc.hint}</span>}
          </label>
        )
      })}
    </>
  )
}
