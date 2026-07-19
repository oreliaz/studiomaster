import { StudioLauncher, defaultEffects } from '@studiomaster/studio-launcher'
import { createLightingAdapter } from '@studiomaster/lighting'
import {
  initialWizardState,
  type LaunchStep,
  type StudioProfile,
  type WizardState,
} from '@studiomaster/shared'

/**
 * WizardOrchestrator — drives the studio opening sequence (docs §6.1):
 * open programs in order → set the lighting standby cue → guided checklist →
 * ready. Holds the single source of truth for WizardState and pushes every
 * change to the renderer via the injected emitter.
 */
export class WizardOrchestrator {
  private state: WizardState = { ...initialWizardState }
  private readonly launcher = new StudioLauncher(defaultEffects)

  constructor(private readonly emit: (state: WizardState) => void) {}

  getState(): WizardState {
    return this.state
  }

  async start(profile: StudioProfile): Promise<WizardState> {
    this.setState({
      phase: 'launching',
      profileId: profile.id,
      steps: profile.programs.map<LaunchStep>((p, i) => ({
        id: `${i}:${p.name}`,
        label: p.name,
        status: 'pending',
        required: p.required,
      })),
      checklist: profile.checklist.map((text) => ({ text, done: false })),
      error: undefined,
    })

    const result = await this.launcher.launch(profile.programs, (_step, all) => {
      this.setState({ steps: all.map((s) => ({ ...s })) })
    })

    if (!result.ok) {
      this.setState({ phase: 'failed', error: 'פתיחת תוכנה חיונית נכשלה — בדוק את הנתיב.' })
      return this.state
    }

    await this.applyStandbyLighting(profile)

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
    this.state = { ...initialWizardState }
    this.emit(this.state)
    return this.state
  }

  private async applyStandbyLighting(profile: StudioProfile): Promise<void> {
    const standby = profile.lighting?.cues?.['standby']
    if (!standby) return
    let adapter
    try {
      adapter = createLightingAdapter(profile.lighting)
    } catch (err) {
      console.warn('[wizard] lighting adapter unavailable:', err)
      return
    }
    if (!adapter) return
    this.setState({ phase: 'lighting' })
    try {
      await adapter.setCue(standby)
    } catch (err) {
      // Lighting is non-fatal for reaching "ready" — surface it but continue.
      console.warn('[wizard] failed to set standby cue:', err)
    }
  }

  private setState(patch: Partial<WizardState>): void {
    this.state = { ...this.state, ...patch }
    this.emit(this.state)
  }
}
