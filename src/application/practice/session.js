export function solarSessionToEntry(session) {
  return {
    kind: 'practice',
    at: session.date,
    clientId: `solar-${session.id}`,
    payload: {
      module: 'soma',
      practiceId: 'solar-breath',
      completed: true,
      durationSec: Math.round((session.durationMs || 0) / 1000),
      form: {
        protocol: session.protocol,
        cadence: session.cadence,
        breaths: session.breaths,
        adherence: session.adherence,
        coherence: session.coherence,
        calmDelta: session.calmDelta,
        checkin: session.checkin || null,
        pulseSource: session.pulseSource || 'none',
        signalQuality: session.signalQuality ?? null,
        heartRate: session.heartRate ?? null,
        rmssd: session.rmssd ?? null,
      },
    },
  };
}
