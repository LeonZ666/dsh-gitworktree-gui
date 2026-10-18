import * as React from 'react'
import { createRoot } from 'react-dom/client'

window.__ModuleLoader__ = {
  load(module) {
    const plugin = module.factory(name => {
      if (name === 'react') return React
      throw new Error(`Unsupported module: ${name}`)
    })
    let dictionaries
    plugin.apply({
      effect: effect => effect(),
      locale: {
        register: (_namespace, values) => { dictionaries = values },
        bind: () => (key, values = {}) => {
          const dictionary = navigator.language.startsWith('zh') ? dictionaries.zh : dictionaries.en
          return (dictionary[key] ?? key).replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? ''))
        },
      },
    })
    const t = (key, values = {}) => {
      const dictionary = navigator.language.startsWith('zh') ? dictionaries.zh : dictionaries.en
      return (dictionary[key] ?? key).replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? ''))
    }
    createRoot(document.getElementById('root')).render(React.createElement(plugin.components.Panel, { t }))
  },
}
import('../client.js')
