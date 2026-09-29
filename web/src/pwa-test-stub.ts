// Only resolved by vitest.config.ts; production uses the PWA plugin's virtual module.
export const useRegisterSW = () => ({ needRefresh: [false], updateServiceWorker: () => Promise.resolve() })
