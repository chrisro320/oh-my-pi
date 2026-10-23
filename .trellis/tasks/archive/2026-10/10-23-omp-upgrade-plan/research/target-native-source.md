# Pinned 18.12.6 native source assessment

Inspected with `xd://ctx web` at commit `45c35e40c46166dc726ccc52f5d27f40f2449f99`; verified quotes below are source observations, not executable acceptance.

## Control/MappingNotify

Source: https://raw.githubusercontent.com/can1357/oh-my-pi/45c35e40c46166dc726ccc52f5d27f40f2449f99/crates/pi-natives/src/desktop/control/linux.rs

Target still resolves Escape from the keyboard map inline in `X11::new`; `X11::run` still has:

```rust
Ok(Some(Event::MappingNotify(_))) => {
    emergency.cancel();
    return;
}
```

The source also filters physical Escape through `DeviceType::SLAVE_KEYBOARD`, excludes `XTEST` and `OMP MPX ` device names, and calls `emergency.escape()`. Migration must retain these target checks while adapting the existing map-refresh repair; do not replace the whole function with an old source copy. The target has no separate `escape_keycode` helper in this file. Wayland uses a separate host interruption/cancellation path; do not claim X11 checks prove Wayland behavior.

## AT-SPI initialization and window ownership

Source: https://raw.githubusercontent.com/can1357/oh-my-pi/45c35e40c46166dc726ccc52f5d27f40f2449f99/crates/pi-natives/src/desktop/linux/ax.rs

`AtSpiAx::new` still calls `rt.block_on(atspi::AccessibilityConnection::new())` without the custom two-second timeout. `native_window_for_frame` still requires:

```rust
!window.id.starts_with("atspi:") && window.pid == Some(pid) && window.title == title
```

The target rejects ambiguous matches with `AT-SPI frame matches multiple native windows; refusing ambiguous input ownership`. `window_root` also compares the exact AX frame name to the native title. The custom profile-decorated Chrome-title match therefore still has a source-level gap. Preserve target PID ownership and ambiguity rejection when porting it.

## Decision

Retain/adapt all three existing native-overlay behaviors: map refresh rather than false cancellation, bounded optional AT-SPI initialization, and narrow Chrome profile-title matching. Rebuild both Linux x64 CPU variants from the target commit and record new original/rebuilt hashes and target stamp. Do not reuse 18.10.1 addon bytes or the past one-release physical-Escape waiver. Exact patch applicability, Rust/toolchain compatibility, addon loading and physical/native safety remain future implementation acceptance gates.
