let ready: Promise<(name: string) => string> | undefined

export function loadDemangler() {
  ready ??= (async () => {
    const [{ default: init }, glue] = await Promise.all([
      import('gecko-profiler-demangle/index_bg.wasm?init'),
      import('gecko-profiler-demangle/index_bg.js'),
    ])
    const instance = await init({ './index_bg.js': { __wbindgen_init_externref_table: glue.__wbindgen_init_externref_table } })
    glue.__wbg_set_wasm(instance.exports)
    ;(instance.exports.__wbindgen_start as () => void)()
    return glue.demangle_any as (name: string) => string
  })()
  return ready
}
