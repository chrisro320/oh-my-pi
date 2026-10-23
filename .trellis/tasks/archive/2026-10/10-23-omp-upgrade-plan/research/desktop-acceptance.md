# Target desktop acceptance evidence

## Observed prerequisites

`computer.capabilities()` reported X11 (`displayServer: :0`), capture/input permissions granted, background window input supported, global Escape supported, three displays, screen unlocked and AT-SPI/AX unavailable. `computer.windows({app: "tern"})` identified one Tern window: application `so.stencil.tern`, window ID `4194305`, title `Default`, PID1131237,2560×1392.

These are host inspection results, not target native-addon acceptance. No control grant was requested, no input was injected and no production OMP was launched by this inspection. The helper's currently loaded addon is not evidence for the new18.12.6 build. AX unavailability is an observed host prerequisite; bounded target behavior still requires a target-rooted scenario.

## Remaining evidence

After the independent target runtime and rebuilt addons are ready: launch only the private synthetic/offline candidate in Tern, capture actual affected UI surfaces, and request live human control approval immediately before physical/native input checks. Physical keyboard/Escape observations require the human action; synthetic input cannot replace them. Keep PID ownership and ambiguity refusal checks, release task-scoped control on every exit, and report unavailable prerequisites without claiming acceptance. No historical waiver applies.
