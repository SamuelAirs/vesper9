// Requested mode and last reported acquisition are different states.
export function microphoneStatus(state) {
  const mode = state.mic?.mode || 'off', capture = !!state.device?.capture;
  if (!state.device?.connected && (capture || mode !== 'off'))
    return { active: true, label: 'MIC UNKNOWN / LINK LOST' };
  if (capture && mode === 'off') return { active: true, label: 'CAPTURE STOPPING' };
  if (state.mic?.error) return { active: capture, label: 'MIC ERROR' };
  if (mode !== 'off' && !capture) return { active: false, label: 'MIC WAITING' };
  return { active: capture, label: ({ off: 'MIC OFF', commands: 'VOICE ON', transcribe: 'TRANSCRIBING' })[mode] || 'MIC OFF' };
}
