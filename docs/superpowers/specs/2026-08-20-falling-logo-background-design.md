# Design Spec: 3D Tumbling Logo Falling Background Effect

## 1. Overview
This feature introduces a cinematic 3D falling and tumbling FinTalk AI logo background effect for the main landing page (`frontend/src/app/page.tsx`). Inspired by natural floating/falling particle dynamics with depth of field (as seen in the reference visual), the FinTalk AI logos will float gently downward from top to bottom while tumbling across multiple 3D axes with realistic depth-of-field layers (varying scale, speed, opacity, and blur).

## 2. Architecture & Components

### 2.1 Component: `FallingLogoBackground`
- **Location:** `frontend/src/components/falling-logo-background.tsx`
- **Type:** Client Component (`"use client"`)
- **Rendering Mechanism:** HTML5 `<canvas>` managed via `requestAnimationFrame` with high-DPI device pixel ratio scaling.
- **Layering:** Fixed full-screen backdrop (`fixed inset-0 pointer-events-none -z-10 overflow-hidden`) positioned behind main landing page content and glassmorphism panels.

### 2.2 Particle Physics & 3D Tumbling Model
Each particle instance possesses:
- `x`, `y`: Viewport coordinate positions.
- `z`: Depth layer value in range $[0.2, 1.0]$.
- `vx`, `vy`: Downward velocity with depth multiplier ($vy \propto z$).
- `rotX`, `rotY`, `rotZ`: Current Euler angles for 3D tumbling.
- `vRotX`, `vRotY`, `vRotZ`: Angular spin velocities.
- `scale`: Base size scaled by depth $z$ ($18\text{px} - 72\text{px}$).
- `opacity`: Opacity based on depth $z$ ($0.2 - 0.85$).
- `blur`: Bokeh blur filter applied for deep background particles ($z < 0.45$).
- `swayPhase`, `swaySpeed`, `swayAmp`: Sinusoidal horizontal oscillation representing air flutter.

### 2.3 Visual Polish & Lighting
- **Atmospheric radial gradients:** Ambient glowing radial backlight subtle accents behind the canvas to enhance the dark/light aesthetic.
- **Subtle interactive mouse parallax:** Particles smoothly drift slightly in response to cursor position.
- **Performance throttles:**
  - Automatically suspends animation loop when page is not visible (`document.hidden`).
  - Respects `prefers-reduced-motion` media query.
  - Zero layout thrashing or DOM node creation per particle.

## 3. Integration Plan
1. Implement `FallingLogoBackground` in `frontend/src/components/falling-logo-background.tsx`.
2. Add `<FallingLogoBackground />` into `frontend/src/app/page.tsx` wrapper.
3. Verify visual appearance on both dark and light modes, testing 60fps performance and responsive resizing.

## 4. Verification Plan
- Visual inspection on local dev server (`http://localhost:3000`).
- Verify smooth 3D tumbling, continuous looping, top-to-bottom motion, and multi-depth visual effects.
- Verify responsiveness across viewport resizes.
