# iOS SFX Implementation Guideline

Use this guide across projects with different interactions, sounds and cue timings. This standalone guide describes audio preparation, gesture handling and playback safeguards without requiring a reference implementation. Validate each project with its own assets, cue timings and target environments.

The reusable principle is: **prepare the exact audio elements early, attempt authorization from real native gameplay gestures, and reuse those same elements whenever their cues occur.** Cue timing belongs to the game; authorization and playback management belong to the shared audio layer.

�Always authorized� is an implementation goal, not a guarantee provided by this guideline. Implementations must handle failed priming and rejected playback. A gesture-seen flag must never be treated as proof that all current or future audio elements can play.

## 1. Core implementation principles

**Diagnostics are opt-in only.** Implement iOS/SFX diagnostics or logging only when the user explicitly requests them. Applying this guideline, implementing SFX, or investigating a playback issue does not by itself authorize adding instrumentation. By default, do not add SFX console logs, trace buffers, diagnostic globals, per-instance history, on-screen audio logs, copy/export controls or sound-test buttons. All diagnostic instructions and checklist items below are conditional on that explicit request; example logs are not required features.

Keep playback safeguards, error catching, request generations, interaction tracking and lifecycle handling even without diagnostics. Runtime state needed for correct playback is separate from optional logging. Existing project-required analytics remain governed by their own requirements. Previously requested diagnostics may remain within their authorized scope; do not copy them into another project by default.

| Implementation approach | Avoid relying on |
| --- | --- |
| Created initial persistent HTMLAudioElement pools during layout, before gameplay input. | Creating the initial delayed/endcard pool only when its screen appeared. |
| Registered immediate and future sounds in an early-mounted parent. | Mounting a separate audio implementation for each screen. |
| Used native capture listeners on the actual gameplay element. | A preliminary page tap, separate unlock button or React-delegated handler alone. |
| Requested the first interaction sound synchronously inside native input. | A timer, effect, animation frame or awaited operation to start the first cue. |
| Started the immediate interaction sound before priming future one-shot voices. | Letting silent preparation delay or replace the audible first cue. |
| Primed existing one-shot voices during native gesture boundaries. | Assuming preload or a global unlocked flag authorized every element. |
| Reused the same primed/rejected elements for later playback and retries. | Replacing a rejected element with a new tag. |
| Promoted a voice into audible playback while its silent priming was settling. | Waiting indefinitely for the priming promise before requesting the actual cue. |
| Used per-voice request counters and media events to handle asynchronous completion. | Allowing an old callback to stop a new sound or revive a canceled request. |
| Separated loop release from one-shot completion. | Stopping all one-shots whenever a drag ended. |
| Paused its detached pools through shared lifecycle state. | Finding every audio instance with a DOM selector. |

Section 9 separates project-specific choices from reusable playback safeguards.

## 2. Prepare every sound before interaction

Import the project's audio assets and call the shared sound hook unconditionally in a parent that remains mounted throughout the playable. Create initial pools in useLayoutEffect, after the DOM/MRAID boot gate and before interaction.

Prepare sounds for all phases, including cues triggered by timers, animations, results and endcards. A sound being used late does not mean its element should be created late.

For each voice:

- Create and retain one HTMLAudioElement with its intended source.
- Configure preload, loop, volume and mute state.
- Install playback, pause, ended and error callbacks.
- Call load() only if needed, such as when readyState is HTMLMediaElement.HAVE_NOTHING, and catch errors.
- Retain the element across gestures, cue requests and screen transitions.

Preloading prepares media; it is not recorded as successful authorization. Track successful priming per voice separately from whether a user gesture occurred.

Size pools for the project's expected overlap and rapid restarts. Exact pool counts, filenames and cue delays are not part of this pattern. Every voice intended for delayed use needs preparation; an earlier gesture does not establish authorization for an element allocated later.

### Pitfall: simultaneous cues restart one shared audio element

When independent inputs request the same sound at nearly the same time, replaying one `HTMLAudioElement` resets its playback position and interrupts the earlier cue. Calling `play()` twice on that element does not create two independent voices. This applies to overlapping taps, impacts, rewards or other events, regardless of the asset or gameplay mechanic.

**Use one pre-created voice per overlapping cue.** The voices may share the same source file; independent playback does not require different sound assets. If the design calls for different-sounding variations, register those assets separately before interaction and apply the same pooling rules to each.

- Size each pool for the maximum supported concurrent cues, including a previous cue that may still be finishing. Apply this capacity to both mobile and desktop where overlap is supported; do not reduce the desktop pool to one voice by default when that would interrupt valid cues.
- For each new cue, prefer an idle, successfully primed voice, then another available idle voice or a silently priming voice that can be promoted immediately. Do not reset or replace an active audible voice while another reusable voice is available.
- Reset only the selected voice for the new cue. Track cue identity, request generation and retries per voice so one cue's callbacks cannot pause, rewind or requeue another cue.
- Request each independent cue synchronously at its authored event unless the interaction explicitly requires staggered starts (see below). Do not collapse separate accepted inputs into one sound. Deduplicate duplicate delivery of the same input, not distinct inputs.
- Keep unrelated sound categories in their own prepared pools so an additional result or transition cue does not take over an interaction voice. Do not allocate new elements at cue time.
- Define a bounded overflow policy for requests beyond the supported capacity, such as dropping the newest cue or replacing the oldest eligible voice. Size the pool so expected overlap does not rely on this fallback. When logging is explicitly requested, log when overflow occurs.
- Preserve valid one-shots after release and manage concurrent input lifetimes as described in section 7. Ending one input must not stop another input's eligible sound.

Regression tests should request multiple cues before the first one finishes and assert that they use distinct pre-created elements, that the first element is neither paused nor rewound by the next request, and that all requested audible voices are unmuted when lifecycle state allows. Also cover promotion of a settling prime, concurrent playback from another sound category, independent rejection/retry, and the chosen overflow policy. Verify the intended overlap on physical devices; identical sounds starting together may blend perceptually even when separate voices play correctly.

### Choose pool ownership independently from the sound asset

A source file, a pool and a playback instance are different things. Several controls can use the same imported source while owning separate pools and separate `HTMLAudioElement` instances. Choose ownership according to which cues must remain independent, not merely which cues share a filename.

| Ownership | Suitable use | Capacity consequence |
| --- | --- | --- |
| Shared pool for several controls | Interchangeable cues with a known maximum overlap | Size for their combined concurrent playback; exhaustion can affect another control. |
| Dedicated pool per control | Each control must have a predictable, isolated playback instance | One control cannot take another control's voice; repeated input on the same control still needs an overflow policy. |
| Separate pool per result or transition category | Cues that can overlap interaction sounds | Result playback must not borrow or reset an interaction voice. |

For dedicated controls, register each pool unconditionally in an early-mounted owner and route each accepted control input to its assigned handle. Keep the shared playback implementation: isolation means separate pool state and media elements, not duplicated audio-management code. A one-instance pool permits one playback at a time for that control. If repeated taps must finish independently, preallocate more instances for that control; otherwise explicitly choose restart or drop behavior. Isolation between controls does not guarantee overlap within one control.

Include every pool, including optional diagnostic controls, in lifecycle volume/pause handling and teardown. Decide which real gestures prepare which pools: a composite gameplay interaction may prepare related future cues, while an independent sound-test control can prepare only its own pool. Never infer that a test button authorizes gameplay pools. A test button is optional tooling, not a required preliminary unlock step.

When diagnostics are explicitly requested, give each pool an owner label and each voice a stable index for diagnostics. Two controls using the same file must remain distinguishable. Request independent cues immediately by default; separate instances do not require a stagger. UI feedback such as a color toggle confirms accepted input only, not successful or audible playback.

### Pitfall: spaced requests still produce simultaneous starts

When a design requires staggered sound onsets, spacing `play()` requests with a fixed timer is insufficient. Cold media startup or authorization delays can hold the earlier request until the later request is ready, making their starts bunch together.

This is an optional timing policy, not an iOS requirement. If staggering is not requested, bypass the queue and playback-start gate entirely rather than retaining the gate with a zero delay. Independently requested sounds may start together after media startup catches up.

Keep the first request synchronous in the native gesture, and prepare all reusable voices in each accepted gesture. Queue subsequent inputs in arrival order. Start the minimum spacing interval from the preceding audible cue's `playing` event, not its request time or fulfilled `play()` promise. Use a separate prepared voice for each cue; do not pause the preceding sound when the next starts. This separates onsets while allowing both tails to finish.

Bind the start notification and cancellation to the specific cue identity, clear them on reset, and ignore duplicate or stale notifications. Provide a bounded failure path so missing playback cannot hang gameplay: cancel only the unstarted cue before advancing the queue, preventing it from starting late beside its successor. Cancel queued work on teardown or lifecycle hiding. Delayed requests retain the shared mobile pending/retry behavior; a timer is not a new authorization gesture.

Test delayed first startup, duplicate notifications, rejected/unsupported playback, cancellation, and independent completion of overlapping voices. A `playing` event is a browser signal rather than proof of speaker timing, so confirm the audible spacing on physical target devices.

## 3. Perform gesture work on the actual gameplay element

Use a mobile detector that matches Android, iPhone, iPad and iPod user agents, plus navigator.platform === 'MacIntel' with navigator.maxTouchPoints > 1 for iPadOS desktop mode. It does not classify every touchscreen as mobile.

It selects native touch events for that mobile strategy when touch events are available. Otherwise it uses pointer events when available, with touch fallback. Install only one path to avoid duplicate starts.

Use stable native callbacks with { capture: true, passive: false } on the real button, draggable element or canvas. Track the accepted pointer/touch identifier. Handle release outside the element, cancellation, lost pointer capture and window blur.

Within an accepted native start, preserve this order:

1. Mark the interaction active through the shared audio handle.
2. Request all cues due immediately from this gesture synchronously. If one interaction triggers several sounds, request each before priming spare voices. Keep intentionally delayed cues at their authored timing.
3. Attempt silent priming of existing future one-shot voices.
4. Continue normal gameplay work and pointer capture.

Do not put an await, timer, React effect or animation frame between the native gesture and those audio requests. Drawing and movement can be queued separately through requestAnimationFrame.

Retry eligible pending requests on native move and release. Release retries happen before clearing interaction state. Native down/up boundaries can retry priming of eligible idle voices; ordinary moves do not silently re-prime the entire pool.

## 4. Separate immediate playback from future-cue preparation

| Sound category | Playback and preparation strategy |
| --- | --- |
| Mobile interaction loop | Request audible playback directly in native start. Do not silently start all spare loop voices on every gesture. |
| Desktop interaction loop | Request the audible voice first, then silently prime eligible spare voices. |
| Future one-shot, on either strategy | Attempt muted playback on existing idle voices during native gesture boundaries; retain those voices for later cues. |

The mobile loop strategy is not preparation for an unrelated loop that starts much later. That new use case needs its own gesture preparation and device verification.

For silent priming, the shared audio layer:

1. Checks that the voice is idle, not already primed, not unsupported and not lifecycle-paused.
2. Saves mute state, mutes the voice and requests playback.
3. Waits for its playing event or playback promise settlement.
4. On success, marks that voice primed, pauses/resets the silent playback and restores mute/volume using current lifecycle state.
5. On failure, leaves authorization unconfirmed and handles failure without replacing the voice.

It does not immediately call silent play() followed by pause() as its only authorization technique. It does not autoplay audible SFX at startup.

## 5. Let cues occur whenever gameplay requires

**Default timing rule:** Unless the developer explicitly specifies a delay, request SFX playback immediately when the developer-defined cue occurs. When a gesture defines the cue, request playback synchronously in that gesture's native handler. Do not add an arbitrary timeout, debounce, animation wait or priming delay before the initial playback request. Any intentional delay must come from the developer's cue specification.

The game requests a cue through the shared hook at its intended event: a gesture, collision, animation completion, timer, result or screen change. The hook selects an existing voice and performs playback. No fixed delay or particular animation sequence is required by the authorization pattern.

Retry throttling and freshness windows apply only to recovery after a failed request; they must not postpone the initial cue. Request playback immediately even if priming is still settling, using the same-element promotion and request-invalidation safeguards below.

| State | Meaning |
| --- | --- |
| Gesture seen | A real gesture reached the shared audio layer. |
| Voice primed | That particular element successfully completed silent preparation. |
| Interaction active | Native retries or an interaction loop are still eligible. |
| Cue valid | The game still wants this sound in the current phase. |
| Playback accepted | The current play request succeeded; lifecycle and cancellation checks still apply. |

The shared audio layer may allow an initial delayed one-shot request after release once a gesture has occurred. It uses a pre-created voice and does not require the player to keep holding until every future cue. This is distinct from resuming an old rejected or canceled sound.

If a cue arrives while its voice is still priming, request audible playback immediately on that same element. Reset position when needed, apply current volume and unmute when lifecycle state permits. Replace the request token so the old silent-priming callback cannot pause the audible request.

A failed silent prime must not cause the real cue attempt to be skipped. Attempt the requested cue, catch failure and apply the pending-request policy. If no further interaction occurs, a rejected delayed cue has no guaranteed native retry opportunity; do not describe priming as eliminating that possibility.

Keep cue validity separate from retry timing. Cancel requests when their screen or game phase is abandoned. Deduplicate animation events and fallback timers so one cue is requested once.

## 6. Handle rejection and asynchronous races

Keep direct media play() calls inside the shared audio hook. Catch synchronous throws and promise rejections. Track idle, priming, starting, playing and pending phases per voice.

- Retry the same rejected element while interaction, visibility and cue validity permit it.
- Clear its primed flag after NotAllowedError.
- Exclude unsupported voices from repeated attempts after NotSupportedError.
- Throttle move-driven retries; allow immediate native-boundary retries.
- Give waiting one-shots a bounded freshness window to avoid irrelevant late sounds.
- Do not truncate successful playback just because its success promise arrives late.
- Reuse ended/released voices and reclaim genuinely stalled requests before treating a pool as exhausted.

Choose retry intervals, freshness windows and stall thresholds for the project. These control recovery and relevance; they are not authorization delays or required cue timings. Timer-driven retries are not a substitute for native gesture handling.

Every prime/play attempt needs a per-voice request generation. Stop, hide, replacement and cancellation must invalidate affected generations. Completion handlers must prevent:

- An old priming callback pausing a newer audible play.
- A late success leaving hidden or canceled audio running.
- A late rejection restoring a canceled cue to pending.
- An obsolete callback interrupting a newer request on the same element.
- Duplicate settlement from both media events and promises.

Preserve current volume and mute state during asynchronous priming. A volume update must not unmute a silent prime.

### Pitfall: a sound is silent on its first trigger but plays on later triggers

A sound can fail on its first use even though later requests for the same sound succeed. One possible cause is a gap between the initial playback request and release-time recovery. This can affect any gesture-triggered cue, regardless of the interaction, asset name or game phase:

1. A native start handler (`touchstart` or `pointerdown`, depending on the input strategy) requests a cue, but its playback promise is still unsettled.
2. The player releases before the audio layer's move/stall retry interval has elapsed.
3. The native release handler skips the still-starting voice because it incorrectly applies that interval to release recovery, then clears the active interaction.
4. If rejection arrives afterward, the hook correctly refuses to requeue a released cue. The opportunity to retry within that same gesture has already been missed.

Check for this sequence when investigating first-use silence; the symptom alone does not prove its cause. Later playback succeeding does not establish that the first request was authorized or audible. Use request diagnostics and device testing to distinguish this race from loading, decoding, visibility or output-routing issues.

**Fix: distinguish native-boundary recovery from move-driven throttling.** Keep the initial cue synchronous in native start. On native release, while the accepted interaction is still active, retry both rejected pending requests and still-starting requests immediately on their existing elements. Do not apply the move/stall delay to this boundary. Retain the visibility, cue-validity, interaction-identity and bounded-freshness checks; a native boundary does not authorize stale requests from an earlier interaction.

The shared layer should enforce this sequence and these safeguards:

- Request every cue due immediately from the accepted interaction before silently priming unused future voices. Apply this ordering whether the interaction triggers one sound or several; do not move delayed cues ahead of their authored event.
- Retry eligible audible requests in native release before clearing interaction state. Also reattempt an unsettled silent prime on that boundary using its existing element and a new request generation.
- Track an audible voice's `playing` event separately from fulfillment of its `play()` promise. Promise fulfillment alone must not disable release recovery when no playing event has been observed. Silent priming may still settle through its promise, as described in section 4.
- Do not restart a voice already observed playing. For recovery of the same cue, preserve `currentTime` so an event arriving late cannot cause audible rewind. A genuinely new cue still resets to the beginning.
- Give every retry a new per-voice generation. A late rejection or resolution from the original start/prime must not cancel, pause or requeue its replacement release attempt.
- End the interaction after release recovery, discard outstanding rejected requests, and prevent them from joining the next gesture. A valid one-shot attempted during release may finish afterward; this does not permit later timer-driven retries or resurrection of a canceled cue.
- Prefer an idle, successfully primed voice when available, while retaining same-element promotion of a settling prime. Do not create a replacement element to work around rejection.

Do not fix this symptom by delaying the initial SFX, adding a preliminary unlock tap, requiring a long press, or replaying a missed cue during a later interaction. Native-boundary recovery supplements the immediate initial attempt; it does not replace it. This release policy applies to still-valid one-shots; stop interaction loops when their interaction ends, as described in section 7.

Regression coverage must include:

- A quick release while the first play promise remains unsettled: retry occurs synchronously on that release, without waiting for the move/stall retry interval.
- The original start request rejects after release retry: the replacement continues unaffected.
- A fulfilled promise without a `playing` event: release recovery remains eligible and preserves playback position.
- An observed `playing` event before release: release does not replay or rewind the cue.
- An unsettled silent prime at release: the same element is reattempted, and obsolete callbacks cannot stop the newer prime or audible cue.
- Hidden state, expired cues, cancellation and a subsequent interaction: stale requests cannot restart.

On a physical iPhone, reload the creative and trigger each sound through its earliest valid interaction. Test quick release and a longer interaction, compare the first trigger with subsequent triggers, and cover interactions that request multiple sounds. Repeat in the target ad WebView using the project's actual cue timings. Test delayed cues separately, including when no further gesture follows. Correlate asset/cue identifiers, requests, rejections and `playing` events in diagnostics. Mock tests establish recovery behavior, not speaker output or iOS authorization success.

## 7. End interactions without destroying future audio readiness

Separate ending a gesture from stopping an entire sound pool:

- Stop the interaction loop and invalidate its pending start on release/cancel.
- Allow an already playing, still-valid one-shot to finish after release.
- Keep prepared future-cue pools mounted and retain their elements.
- Invalidate affected requests on explicit cancellation, teardown or lifecycle pause.

Retry eligible pending cues before clearing interaction state, then discard outstanding requests tied to the ended interaction. A new valid delayed cue may still be requested later through the existing prepared handle; it is not a continuation of the discarded request.

Use separate handles for independently controlled sound categories. Stopping an interaction loop must not stop unrelated eligible one-shots. Remove native listeners on cleanup.

### Pitfall: concurrent inputs share a single active flag

If several gameplay elements can be touched at once, a shared audio `active` boolean is insufficient. One element's release can clear that flag while another accepted touch remains down. Pending cues then lose the remaining touch's native retry opportunity. Single-touch tests do not cover this sequence.

- Give each accepted input a unique token and track active tokens in the shared audio layer. Duplicate releases and rejected selections must not remove another input's token.
- For cues belonging to one combined multi-touch interaction, retain retry eligibility until its final accepted input ends. Retry in the native release handler before removing that input's token. Preserve separate lifetimes for unrelated interactions and stop each interaction loop when its owning input ends.
- Associate a changed touch with the actual element it targets; never assume `changedTouches[0]` belongs to every element receiving a batched event. Match subsequent moves/releases/cancellations by identifier.
- Deduplicate shared audio recovery when multiple element listeners receive the same native event, while still ending each affected input token. Request all eligible audible retries before silent priming.
- If the project supports concurrent touch pointers, do not reject the second one solely because `isPrimary` is false. Keep the intended mouse-button filtering.
- Test two inputs from a fresh load, both release orders, batched release, cancellation of one input, blur, rejected selections and teardown. Verify that one release preserves the remaining input's retries and the final release prevents stale retries.

This addresses application input bookkeeping, not a guarantee that a browser authorizes audio during every multi-touch gesture. Confirm actual playback in the target iOS environment and correlate failures with per-cue diagnostics and the active-input count.

### Pitfall: mixed input handlers cancel a gesture before audio release recovery

**Symptom:** a first-use sound is requested with audible settings, but the media element becomes paused or reports `ended` near the beginning without a recorded `playing` event. The trace also contains gesture termination without the expected native release retry; later attempts may work. This pattern can affect any asset or interaction. It is a reason to inspect event ownership, not proof of a particular browser failure or a universal explanation for early media completion.

Selecting TouchEvents for gameplay is not enough if cleanup still listens unconditionally to PointerEvents. A `lostpointercapture` listener can clear a touch-owned interaction before its `touchend` recovery handler runs. The trace can then show a valid cue request and gesture termination without any release retry. Capture loss can occur as part of normal pointer release; it is not by itself proof that the selected touch interaction was canceled. See the [Pointer Events specification on implicit release](https://www.w3.org/TR/pointerevents/#implicit-release-of-pointer-capture).

Register start, move, release and cancellation handlers for the same selected input path. A TouchEvent path uses `touchcancel`; register `lostpointercapture` only for a PointerEvent path, and match its `pointerId` to the owned pointer. Keep blur and teardown cleanup shared. Record the actual event type for release/retry/cancel diagnostics instead of labeling every ending merely �gesture-end.�

Use this ownership map for each accepted interaction:

| Selected input path | Start | Move/retry | Release/retry before ending | Cancellation |
| --- | --- | --- | --- | --- |
| TouchEvents | `touchstart` | `touchmove` | `touchend` | Matching `touchcancel`; ignore compatibility pointer capture loss |
| PointerEvents | `pointerdown` | `pointermove` | `pointerup` | Matching `pointercancel` or `lostpointercapture` |

On a normal release, first verify the owned identifier, run eligible audio recovery synchronously, then remove that input's token. On genuine cancellation, invalidate the affected interaction without manufacturing a release or replaying canceled sounds. Duplicate or unrelated events must be harmless. Do not remove legitimate pointer-capture cleanup from the PointerEvent path to fix a TouchEvent-path conflict.

When diagnostics are explicitly requested, record the input event type and identifier, active-input count, cue/voice identity, request generation, visibility gates, mute/volume, ready state, media paused/ended/seeking state, duration and playback position. Record native release-handler entry even if no voice qualifies for retry. Keep initial-attempt entries as well as recent entries in a bounded trace so repeated attempts do not erase the original failure. A copied trace or on-screen diagnostic snapshot should identify its build; capture it after reproduction without requiring a preliminary diagnostic tap that could change audio authorization.

Regression tests must interleave compatibility pointer capture loss with active touches, then deliver `touchend` and assert that native release recovery still runs before the interaction ends. Also verify that the PointerEvent path continues to cancel on capture loss for its own identifier and ignores another pointer's capture loss. Cover single and concurrent inputs, both release orders, real cancellation, blur and teardown. Do not generalize successful promise settlement into confirmed playback: inspect paused/ended state, playback position and the `playing` event independently.

After correcting handler ownership, rerun the project's checks and retest the earliest valid cue from a fresh load on physical iOS in the target host. Passing simulated-event tests establishes that the application no longer suppresses release recovery; it does not establish why the media ended early or confirm audible device playback. If silence persists, compare the new event-labeled trace before changing playback timing or adding another workaround.

## 8. Apply lifecycle state to every voice

For AppLovin, keep MRAID listeners centralized. The app passes the combined pause condition into the hook: MRAID hidden, not viewable, not exposed, or document hidden.

Seed viewability from mraid.isViewable() when available and handle state, exposure, viewability and document visibility changes. Apply SDK volume only for valid numeric payloads; ignore null.

Pause/mute every pooled instance when hidden or non-exposed. These instances can be detached, so DOM queries alone are insufficient. Invalidate in-flight requests; resume only an eligible loop whose interaction remains active when every visibility gate permits playback. Do not resume stale one-shots.

On teardown, stop pools, remove media callbacks, release sources and clear references. Keep React setup/cleanup safe for effect reruns. Audio hooks and gameplay components receive lifecycle state rather than calling MRAID themselves.

### Pitfall: consuming an endcard cue while lifecycle-paused

An iframe `load`, video `loadeddata`, or readiness fallback can fire while AppLovin reports the creative hidden, not viewable, or non-exposed. Asset readiness is not permission to play audio.

An implementation can lose this cue by calling its endcard reveal callback directly from the iframe readiness path and marking the endcard as announced before calling the sound hook. If the shared hook is lifecycle-paused, `play()` may safely return without playback while the announcement flag is already consumed. Restoring visibility then cannot request the endcard sound.

Avoid this sequence:

```tsx
// Wrong: readiness may arrive while the creative is hidden.
setVisible(true);
onReveal(); // Marks the cue handled, even if the audio hook skips it.
```

For a cue defined as �the endcard is first shown,� separate asset readiness from the first eligible presentation. Commit the ready screen, then announce it once only when the combined lifecycle pause condition is false:

```tsx
const announced = useRef(false);
const live = useRef(onReveal);
live.current = onReveal;

// The deduplicated iframe/media readiness handler only sets visible=true.
useEffect(() => {
  if (!visible || paused || announced.current) return;
  announced.current = true;
  live.current(); // App callback requests the pre-created endcard SFX.
}, [visible, paused]);
```

Here `visible` means the ready screen has been committed; `paused` combines document visibility and all MRAID visibility/exposure gates. The shared sound hook must still enforce those gates. Keep the announcement guard for the same logical screen appearance, including effect reruns. Cancel an unannounced cue if that screen is abandoned. Do not reset the guard on every hide/show cycle.

This defers the **initial presentation cue**, not a previously played, rejected, or canceled one-shot. Once requested, the usual rejection, freshness, interaction and cancellation rules apply. Do not add a generic �replay endcard audio on visibility resume� handler. This effect pattern is for asynchronous screen presentation; immediate gesture SFX must still be requested synchronously in their native gameplay handler.

Verification must include: make the endcard ready while MRAID viewability is false; assert no cue is consumed; restore viewability and assert exactly one cue request; hide/show again and assert no duplicate. Also verify normal visible entry and entering through controls that bypass other gameplay, so the endcard pool still receives native gesture preparation.

### Pitfall: treating a cue request or resolved play promise as audible playback

For device investigations with explicitly requested diagnostics, record the triggered cue and assigned asset separately from its playback outcome. Capture skipped requests (no gesture, hidden state, unavailable pool, unsupported media), thrown/rejected playback errors, the media `playing` event, interruptions, mute state and volume. Correlate outcomes to an individual cue request so overlapping instances and retries cannot update the wrong cue.

Do not label silent priming or a fulfilled `play()` promise as confirmed audible SFX. A diagnostic timeout can flag �no playing event observed� without modifying playback or retrying from a timer. A media `playing` event confirms a browser playback signal, not physical speaker output; device mute, audio routing and host behavior still require physical-device verification.

### Optional, explicitly requested diagnostics: record authorization evidence without inventing a permission state

Only after an explicit request for diagnostics or logs, use a bounded, serializable event trace. Add an on-screen copy mechanism when explicitly requested or included in the requested diagnostic UI scope. Preserve the first attempts as well as recent events. Freeze the snapshot before opening diagnostic UI so the diagnostic interaction does not contaminate the captured sequence. Do not include embedded media payloads in logs.

Record the following fields, adapting names to the project:

| Evidence | What to record and how to interpret it |
| --- | --- |
| Environment | Build identifier, capture time, user agent, platform, touch capability and iOS/iPadOS detection. Detection describes the selected strategy, not an exact engine diagnosis. |
| Identity | Pool owner, voice index, cue identifier and request generation. Record instance creation so never-used voices are distinguishable from missing data. |
| Native input | Start/release/cancel event type, trusted-event flag, event time and active accepted-input count. Identify the owning input when needed for multi-touch analysis. |
| Browser activation | `navigator.userActivation.isActive` and `hasBeenActive` when available; use `null` when unavailable. These are context-level signals, not per-element audio permissions. |
| Preparation history | Whether preparation/playback has been accepted for this voice, last successful silent-prime timestamp, last audible-request `playing` timestamp and last rejection name. Clearly distinguish silent preparation from audible requests. |
| Media state | Muted, volume, paused, ended, seeking, currentTime, duration, readyState, networkState and media error code. Keep non-finite or unavailable values explicitly unknown in exported JSON. |
| Request and lifecycle | Initial request, retries, request age, skipped/canceled reason, interruption, completion and combined lifecycle pause state. Record updates if presenting a current-state summary. |

Do not expose a boolean called �authorized� derived from a gesture, priming flag or user-activation flag. Label per-element permission as **not directly observable** and show the underlying evidence. A trusted event establishes input provenance; it does not establish a particular audio outcome. Likewise, a trace may contain `userActivation: false` alongside successful `playing` and `ended` events. Do not block or skip playback solely on that diagnostic flag, and do not interpret it alone as a permission rejection.

Keep historical timestamps explicitly historical. A previous successful prime or playback does not guarantee a later attempt will succeed. A previous rejection does not mean a later successful attempt is still blocked. For `NotAllowedError`, report the actual rejection and invalidate preparation as required by the shared recovery policy; retain the original error name for other failures rather than labeling every failure �permission denied.�

An on-screen per-instance summary reconstructed from the last event is a **latest recorded state**, not a live media snapshot. Events logged before a state transition or untouched voices with only creation entries can show older phase, readiness or lifecycle values. Label that limitation, or implement a separate read-only snapshot of all pools. Use chronological cue events to assess playback rather than reading a single stale row as current truth.

For each suspect cue, compare request time, first `playing` event, position at that event, retries, and final position/duration. A start at zero and completion at full duration establish browser-reported progress; they do not establish that the full opening was heard. Ask for the listener's observation when the trace shows normal progress but the reported symptom is silence or truncation. Do not add timing or codec workarounds solely because authorization remains unknown.

## 9. Project-specific choices are not authorization requirements

An optional reference implementation may use different pool sizes, retry policies or cue categories. Assess those choices against the adopting project's requirements rather than copying them as prerequisites for iOS playback.

| Implementation choice | Generalized guidance |
| --- | --- |
| Growing an exhausted pool inside play(). | A new voice has not received earlier priming attempts. Preallocate capacity and use a defined bounded overflow policy instead of allocating at cue time. |
| Retaining a rejected one-shot after release for a later gesture. | This is a retry policy, not authorization for future sounds. Discard pending requests tied to the ended interaction; keep new delayed cues distinct from stale requests. |
| Disabling retries for a particular reveal cue. | Define cue validity and freshness explicitly. Preserve shared pending/retry safeguards for eligible requests. |
| Using an immediate loop and future one-shots. | Choose categories to match actual gameplay. Do not assume a loop-specific preparation method primes future one-shots. |

Keep persistent-element ownership, native gesture ordering, priming, same-element playback, request invalidation and lifecycle handling together. Asset names, pool counts, transition lengths and retry constants are not iOS authorization requirements.

## 10. Reuse checklist

Diagnostic-specific items apply only when diagnostics were explicitly requested; otherwise mark them not applicable and omit that instrumentation.

- [ ] iOS/SFX logging, trace collection and diagnostic UI are absent unless explicitly requested by the user.
- [ ] All immediate and future SFX pools exist before the first gameplay gesture.
- [ ] The actual gameplay element has one deduplicated native input path, with iPadOS and desktop support.
- [ ] The first audible cue is requested synchronously before future-voice priming work.
- [ ] Every SFX is requested immediately at its developer-defined cue unless an explicit delay is specified; gesture cues have no arbitrary wait.
- [ ] Future one-shot voices receive priming attempts during native gesture boundaries.
- [ ] Delayed cues reuse the exact prepared elements without remounting their owner.
- [ ] A gesture flag is not used as proof that every voice is authorized.
- [ ] In-flight priming can become an audible cue without an old callback stopping it.
- [ ] Thrown and rejected playback failures are caught; retries reuse the same element.
- [ ] Quick native release retries eligible pending and still-starting cues before ending the interaction, without move/stall throttling.
- [ ] Promise fulfillment and `playing` events are tracked separately; release recovery preserves position and does not restart observed playback.
- [ ] Unsettled primes can be retried at release, and obsolete callbacks cannot affect the replacement attempt.
- [ ] Cue validity, retry freshness and interaction lifetime are separate decisions.
- [ ] Concurrent inputs use distinct accepted-input tokens; releasing one cannot clear another's audio retry eligibility, and batched touches are matched to their targets.
- [ ] Cleanup uses the selected input path; compatibility pointer capture loss cannot terminate a touch-owned interaction before native release recovery.
- [ ] Release, cancellation and hidden state cannot revive stale sounds through late callbacks.
- [ ] Endcard readiness while hidden does not consume its initial presentation cue; first eligible visibility requests it once, with no replay on subsequent visibility changes.
- [ ] Device diagnostics distinguish cue assignment, playback request, rejection/skipping, and observed media playback without claiming confirmed speaker output.
- [ ] Each independently owned control has an identifiable pre-created pool; one-instance repeat behavior and shared-pool overflow are explicit.
- [ ] Diagnostic controls use the shared audio layer and lifecycle handling without becoming a required gameplay unlock step.
- [ ] Activation flags, historical priming/playback results and actual errors are recorded separately; unavailable evidence is not reported as false or as permission denial.
- [ ] Per-instance summaries distinguish latest logged state from live state, and physical audibility is confirmed separately from media progress.
- [ ] Overlapping sounds have sufficient pre-created voices; stopping a loop preserves eligible one-shots.
- [ ] Independent simultaneous cues use distinct reusable voices; the next cue cannot pause or rewind an earlier cue while capacity remains, including on desktop.
- [ ] Duplicate input delivery is deduplicated without merging separate accepted inputs, and pool overflow has an explicit bounded policy.
- [ ] No audible autoplay, separate unlock screen or replacement audio tags are introduced.
- [ ] Physical-device checks cover first interaction, delayed cues after release, rapid restart, overlap and visibility changes.

Test delayed cues at the new project's actual timings, including cases where no further gesture follows. Include failed or slow priming/playback in regression tests. Browser emulation and successful promises alone do not establish audible physical-device playback.

## Reference and verification record

A reference implementation is optional. This guideline can be applied without another repository, local folder, historical investigation or device trace. If no reference is available, record **Reference: none provided** and proceed using this guide and the adopting project's requirements. Do not assume a reference exists, invent source paths or test results, or make access to an unrelated project a prerequisite.

Keep a project-specific verification record alongside the adopting project's implementation. Record only evidence actually inspected or tests actually performed. This guideline does not certify any build or carry test results from one project to another.

### Optional reference information

When a reference is available and relevant, record its accessible location, revision/build, inspection date and the parts inspected. Identify sources by responsibility, such as shared audio pools, early sound registration, native input, lifecycle wiring and regression coverage; filenames and folder structure may differ. Note which behavior was adopted and any differences in assets, cue timing, platform strategy or host environment.

If a supplied reference cannot be accessed, record **Reference: unavailable** and the limitation. Continue implementation and local verification where possible. Treat a reported success on another build or device as attributed evidence with its stated scope, not confirmation that the current project works.

### Verification record template

Fill in this record for the actual build under review. Use **not run**, **unverified**, **unknown** or **not applicable**, with a reason where useful, instead of implying a pass when evidence is missing.

| Field | What to record |
| --- | --- |
| Project and build | Project identifier, revision/build identifier and test date. |
| Reference (optional) | None provided, unavailable, or an inspected location and revision with the scope of inspection. |
| Implementation inspected | Actual files or modules reviewed for pool ownership, native gesture ordering, retries, lifecycle handling and cue timing. |
| Assets and cue behavior | Tested assets/formats, pool ownership and capacity, immediate/delayed cues and any intentional timing policies. |
| Automated checks | Commands/scenarios run, results and limitations; distinguish controlled-media tests from real browser media playback. |
| Browser and host | Browser/version, operating system and runtime host, including the target ad-network preview or WebView where tested. |
| Physical-device checks | Device model, OS version, build tested, scenarios exercised, observer and observed audible results. Mark unavailable checks unverified. |
| Diagnostics (optional) | Only when explicitly requested: trace/build identity, capture coverage and gaps. Otherwise record not applicable; no instrumentation is required to complete this record. |
| Findings and follow-up | Reproduced symptom, evidence supporting a suspected cause, changes tested, unresolved issues and the next verification needed. |

### Required scope and evidence limits

- Verify first use from a fresh load without a preliminary tap, quick release, sustained interaction, repeat/restart, independent overlapping cues, delayed cues with no further gesture, and visibility changes. Include endcard readiness while hidden when applicable.
- Test the project's actual assets and cue schedule in desktop Chromium, Safari/WebKit and the target ad-network host, plus physical iPhone/iPad and Android devices where supported and available. Record each environment separately; unavailable physical-device checks remain unverified.
- A source review establishes inspected behavior. A passing regression establishes the covered behavior under its test conditions. Type checking and a successful build establish neither iOS authorization nor audible output.
- A fulfilled playback promise, a media playing event or a full-duration trace is browser evidence. Confirm physical audibility, including the complete opening of the sound, through listener observation on the tested device and host.
- Keep reported symptoms, suspected causes, corrected code paths and confirmed device outcomes separate. Do not label a fix successful on physical iOS until the affected scenario is retested there. If the symptom persists, retain that unresolved status.
- Validate asset-format or playback-order changes against actual decoding, duration, sound quality, embedded MIME type, overlapping playback and the build size budget. A workaround or similar historical browser issue does not establish a universal cause or solution.

Keep dated investigation history and detailed device traces in the adopting project's own record. Add reusable lessons to the relevant sections of this guide without making its use depend on that history.
