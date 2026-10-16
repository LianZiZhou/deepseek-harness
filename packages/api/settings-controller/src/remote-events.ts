/** Settings Controller events available to a Remote Event assembly. */
type SettingsControllerRemoteEvent =
  | 'api-authorization/notice'
  | 'api-authorization/prompt'
  | 'api-authorization/prompt-closed'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteEventSelection extends
    Record<SettingsControllerRemoteEvent, true> {}
}

export {}
