# 3D Tumbling Logo Background Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a high-performance 3D tumbling & falling FinTalk AI logo background effect on the main landing page (`frontend/src/app/page.tsx`).

**Architecture:** An HTML5 `<canvas>` client component (`FallingLogoBackground`) running a delta-timed `requestAnimationFrame` loop that simulates multi-depth particles tumbling in 3D (pitch/yaw/roll rotations) with depth-of-field scale, speed, bokeh blur, and atmospheric ambient glow.

**Tech Stack:** Next.js (App Router), React 19, TypeScript, Tailwind CSS, HTML5 Canvas API.

## Global Constraints
- Target page: `frontend/src/app/page.tsx`
- Logo source: `/logo.png`
- Non-blocking, `pointer-events-none`, accessible, and paused on hidden tab / `prefers-reduced-motion`.

---

### Task 1: Create the `FallingLogoBackground` Canvas Component

**Files:**
- Create: `frontend/src/components/falling-logo-background.tsx`

**Interfaces:**
- Produces: `export function FallingLogoBackground({ count = 16, className = '' }: { count?: number; className?: string })`

- [ ] **Step 1: Write `FallingLogoBackground` component implementation**

Implement particle initialization, image loading for `/logo.png`, 3D projection/rotation (`scale(cos(yaw), cos(pitch))` and `rotate(roll)`), horizontal swaying drift, viewport resizing, DPI scaling, and background tab throttling.

- [ ] **Step 2: Verify component builds with TypeScript without errors**

Run: `npx tsc --noEmit -p frontend` (or check build)

---

### Task 2: Integrate `FallingLogoBackground` into Landing Page (`frontend/src/app/page.tsx`)

**Files:**
- Modify: `frontend/src/app/page.tsx`

**Interfaces:**
- Consumes: `FallingLogoBackground` from `@/components/falling-logo-background`

- [ ] **Step 1: Import and mount `<FallingLogoBackground />`**

Add `<FallingLogoBackground />` into `frontend/src/app/page.tsx` with proper layout stacking (`relative z-10` for main content and header).

- [ ] **Step 2: Test & verify rendering locally**

Verify the tumbling 3D rotation, top-to-bottom falling motion, and dark/light mode visual appeal.

---
