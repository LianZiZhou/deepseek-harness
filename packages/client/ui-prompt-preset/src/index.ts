/**
 * Prompt-preset surface plugin, node half. The empty apply exists so the plugin
 * appears in the host cordis.yml / Loader; the browser half ships the settings
 * section and the per-session switcher through exports["./client"], discovered
 * from the package.json dsh.client declaration.
 */

/** Host plugin body — no host-side behavior for this surface plugin. */
export function apply(): void {}
