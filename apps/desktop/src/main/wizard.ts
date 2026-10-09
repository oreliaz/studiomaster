import { StudioLauncher, defaultEffects } from '@studiomaster/studio-launcher'
import { createLightingAdapter } from '@studiomaster/lighting'
import {
  initialWizardState,
  type LaunchStep,
  type StudioProfile,
  type WizardState,
} from '@studiomaster/shared'

export interface WizardDeps {
  emit(state: WizardState): void
  /**
   * Connect StudioMaster to OBS, waiting for OBS to come up. Resolves with a
   * short detail (e.g. the obs-websocket version), rejects if OBS never answers.
   */
  connectObs(): Promise<string | undefined>
}

const OBS_STEP_ID = 'sys:obs'
const LIGHTING_STEP_ID = 'sys:lighting'

/**
 * WizardOrchestrator — drives the "start everything" sequence on the home
 * screen (docs §6.1): open programs in order → connect to OBS → set the
 * lighting standby cue → guided checklist → ready. Holds the single source of
 * truth for WizardState and pushes every change to the renderer via the
 * injected emitter.
 */
export class WizardOrchestrator {
  private state: WizardState = { ...initialWizardState }
  private readonly launcher = new StudioLauncher(defaultEffects)
  private running = false

  constructor(private readonly deps: WizardDeps) {}

  getState(): WizardState {
    return this.state
  }

  async start(profile: StudioProfile): Promise<WizardState> {
    // One sequence at a time (auto-start on launch + a click must not race).
    if (this.running) return this.state
    this.running = true
    try {
      return await this.run(profile)
    } finally {
      this.running = false
    }
  }

  private async run(profile: StudioProfile): Promise<WizardState> {
    const standbyCue = profile.lighting?.cues?.['standby']
    const systemSteps: LaunchStep[] = [
      { id: OBS_STEP_ID, label: 'OBS', status: 'pending', required: true, kind: 'obs' },
    ]
    if (standbyCue) {
      systemSteps.push({
        id: LIGHTING_STEP_ID,
        label: 'Lighting',
        status: 'pending',
        required: false,
        kind: 'lighting',
      })
    }

    this.setState({
      phase: 'launching',
      profileId: profile.id,
      steps: [
        ...profile.programs.map<LaunchStep>((p, i) => ({
          id: `${i}:${p.name}`,
          label: p.name,
          status: 'pending',
          required: p.required,
        })),
        ...systemSteps,
      ],
      checklist: profile.checklist.map((text) => ({ text, done: false })),
      error: undefined,
    })

    const result = await this.launcher.launch(profile.programs, (_step, all) => {
      this.setState({ steps: [...all.map((s) => ({ ...s })), ...this.systemSteps()] })
    })

    if (!result.ok) {
      for (const s of systemSteps) this.updateStep(s.id, { status: 'skipped' })
      this.setState({ phase: 'failed', error: 'פתיחת תוכנה חיונית נכשלה — בדוק את הנתיב.' })
      return this.state
    }

    this.setState({ phase: 'connecting' })
    this.updateStep(OBS_STEP_ID, { status: 'running' })
    try {
      const detail = await this.deps.connectObs()
      this.updateStep(OBS_STEP_ID, { status: 'ok', detail })
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      this.updateStep(OBS_STEP_ID, { status: 'failed', detail })
      if (standbyCue) this.updateStep(LIGHTING_STEP_ID, { status: 'skipped' })
      this.setState({
        phase: 'failed',
        error: 'לא הצלחנו להתחבר ל-OBS — ודא ש-OBS פתוח ושה-WebSocket מופעל (פורט 4455).',
      })
      return this.state
    }

    if (standbyCue) await this.applyStandbyLighting(profile, standbyCue)

    this.setState({ phase: this.state.checklist.length > 0 ? 'checklist' : 'ready' })
    return this.state
  }

  setChecklistItem(index: number, done: boolean): WizardState {
    const checklist = this.state.checklist.map((item, i) =>
      i === index ? { ...item, done } : item,
    )
    this.setState({ checklist })
    return this.state
  }

  finishChecklist(): WizardState {
    if (this.state.phase === 'checklist') this.setState({ phase: 'ready' })
    return this.state
  }

  reset(): WizardState {
    if (this.running) return this.state
    this.state = { ...initialWizardState }
    this.deps.emit(this.state)
    return this.state
  }

  private async applyStandbyLighting(profile: StudioProfile, cue: string): Promise<void> {
    this.setState({ phase: 'lighting' })
    this.updateStep(LIGHTING_STEP_ID, { status: 'running' })
    try {
      const adapter = createLightingAdapter(profile.lighting)
      if (!adapter) {
        this.updateStep(LIGHTING_STEP_ID, { status: 'skipped' })
        return
      }
      await adapter.setCue(cue)
      this.updateStep(LIGHTING_STEP_ID, { status: 'ok' })
    } catch (err) {
      // Lighting is non-fatal for reaching "ready" — surface it but continue.
      console.warn('[wizard] failed to set standby cue:', err)
      this.updateStep(LIGHTING_STEP_ID, {
        status: 'failed',
        detail: err instanceof Error ? err.message : String(err),
      })
    }
  }

  /** The StudioMaster-component steps (OBS, lighting) currently in the state. */
  private systemSteps(): LaunchStep[] {
    return this.state.steps.filter((s) => s.kind && s.kind !== 'program')
  }

  private updateStep(id: string, patch: Partial<LaunchStep>): void {
    this.setState({ steps: this.state.steps.map((s) => (s.id === id ? { ...s, ...patch } : s)) })
  }

  private setState(patch: Partial<WizardState>): void {
    this.state = { ...this.state, ...patch }
    this.deps.emit(this.state)
  }
}
