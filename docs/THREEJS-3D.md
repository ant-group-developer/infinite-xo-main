# Nghiên cứu: phiên bản 3D bằng Three.js (vẽ hoàn toàn bằng code)

Mục tiêu: giữ nguyên `core/` + `ai/` + `app.ts`, chỉ viết thêm `view3d/ThreeView.ts` implement interface `BoardView` (`src/view/BoardView.ts`) và cho người chơi chuyển 2D ⇄ 3D.

## 1. Chọn phiên bản & renderer

- npm `three` hiện là **0.187.0** (kiểm tra 2026‑11‑03). Pin đúng version: `npm i three@0.187.0 @types/three`.
- Hai lựa chọn renderer:

| | `WebGLRenderer` (`three`) | `WebGPURenderer` (`three/webgpu`) |
|---|---|---|
| Độ ổn định | chín muồi, chạy mọi nơi | docs three.js vẫn ghi **experimental**, nhưng là hướng phát triển chính; tự fallback WebGL2 |
| Shader custom | `ShaderMaterial` / `onBeforeCompile` | phải viết bằng **TSL** (node material) – không hỗ trợ ShaderMaterial |
| Post‑processing (bloom) | `EffectComposer` + `UnrealBloomPass` | stack mới (`PostProcessing` + `bloom()` node), không dùng EffectComposer |

**Khuyến nghị:** bắt đầu bằng `WebGLRenderer` + `EffectComposer/UnrealBloomPass` (ít rủi ro, nhiều ví dụ). Code tách gọn để sau đổi sang `WebGPURenderer` + TSL nếu cần.

## 2. Thiết kế scene

```
Scene
├─ PerspectiveCamera (fov ~40°) nhìn xiên ~55° xuống mặt bàn   ← cảm giác "bàn trên sàn synthwave"
├─ Board plane: PlaneGeometry lớn bám theo camera (không cần mesh vô hạn)
│    material vẽ lưới bằng shader: fract(worldPos.xz) → đường kẻ, đậm mỗi 5 ô, fade theo khoảng cách
├─ Pieces
│    X: 2 × CapsuleGeometry (hoặc TubeGeometry) xoay ±45°, MeshStandardMaterial emissive hồng
│    O: TorusGeometry(r, tube, 16, 48) emissive cyan
│    → InstancedMesh cho mỗi loại (1 draw call cho hàng trăm quân); setMatrixAt khi đặt quân
├─ Hover ghost: 1 mesh trong suốt (opacity .25)
├─ Last‑move / hint ring: RingGeometry + animate scale/opacity
├─ Win beam: CylinderGeometry/Tube nối start→end, emissive mạnh để bloom
├─ Particles: Points + BufferGeometry, cập nhật vị trí trong vòng lặp
└─ Background: fog + sàn lưới synthwave + mặt trời gradient (ShaderMaterial / TSL), hoặc giữ CSS nền phía sau canvas trong suốt (alpha: true)
Post: RenderPass → UnrealBloomPass(strength ~0.9, radius 0.4, threshold 0.2) → OutputPass
```

Mọi thứ đều là geometry/shader sinh bằng code → không cần file model/texture.

## 3. Bàn vô hạn trong 3D

- **Lưới vô hạn bằng shader**: một plane đủ lớn (vd 400×400) đặt dưới camera, dịch theo `camera target` mỗi frame (snap theo bội số 1 ô để không trượt). Fragment shader:
  ```glsl
  vec2 g = abs(fract(vWorld.xz - 0.5) - 0.5) / fwidth(vWorld.xz);
  float line = 1.0 - min(min(g.x, g.y), 1.0);
  // vạch đậm mỗi 5 ô: lặp lại với vWorld.xz / 5.0
  // fade: alpha *= 1.0 - smoothstep(near, far, distance(vWorld.xz, uCamTarget))
  ```
  (`fwidth` cho đường kẻ nét đều ở mọi khoảng cách; với TSL dùng các node tương đương.)
- Toạ độ ô ↔ thế giới: `world = (x, 0, y)` — giữ y của game ↔ trục z.
- **Picking**: không raycast từng ô. Raycast tia chuột vào mặt phẳng `y = 0` (`THREE.Plane` + `ray.intersectPlane`) → `Math.round(p.x), Math.round(p.z)` = ô. O(1), không phụ thuộc số quân.
- **Camera điều khiển**: `MapControls` (`three/examples/jsm/controls/MapControls.js`) cho pan/zoom/xoay quanh; giới hạn `maxPolarAngle` để không nhìn xuống dưới bàn, `minDistance/maxDistance` như min/max zoom 2D. Hoặc tự viết như `Camera` 2D (pan theo mặt phẳng) để giữ cảm giác giống bản 2D và phân biệt tap vs drag giống `CanvasView`.
- **Độ chính xác số**: ván dài có thể đi xa gốc vài trăm ô — vẫn ổn với float32; nếu muốn chắc chắn, dùng "floating origin" (dời cả scene khi target cách gốc > 1000).

## 4. Hiệu năng

- `InstancedMesh` cho X và O (count tối đa ~ 1000, tăng gấp đôi khi đầy) → 2 draw call cho toàn bộ quân.
- Quân đang animation (pop/drop) là mesh riêng tạm thời, xong thì chuyển vào instance.
- `renderer.setPixelRatio(Math.min(devicePixelRatio, 2))`; bloom ở nửa độ phân giải trên mobile.
- Chỉ render khi có thay đổi/animation (render‑on‑demand) để tiết kiệm pin; bloom tốn GPU.
- `ResizeObserver` trên `.stage`, giống `CanvasView`.

## 5. Hiệu ứng gợi ý (3D "juice")

| Sự kiện | Hiệu ứng |
|---|---|
| Đặt quân | rơi từ trên xuống (y: 1.5 → 0) với easing bounce + vòng sóng trên mặt bàn |
| Hover | ghost nổi nhẹ + ô sáng |
| Thắng | beam laser nối chuỗi, quân thắng nhảy lên/xoay, camera dolly tới fit chuỗi, particles |
| Thua | camera shake nhẹ |
| Idle | O xoay chậm quanh trục, X "thở" emissive |

## 6. Kế hoạch triển khai

1. `npm i three@0.187.0 @types/three` (dynamic `import()` để bản 2D không phải tải three.js).
2. `src/view3d/ThreeView.ts implements BoardView`: scene + camera + lưới shader + picking + instanced pieces.
3. Thêm nút **2D / 3D** trong HUD → `view.destroy()` rồi tạo view mới với cùng `Game`.
4. Bloom + hiệu ứng thắng + particles.
5. Kiểm tra mobile (pinch → zoom camera), fallback về 2D nếu không có WebGL.

Ước lượng: bước 1–3 khoảng 1 ngày công; 4–5 thêm 1 ngày.

## Nguồn
- three.js manual – WebGPURenderer: https://threejs.org/manual/en/webgpurenderer
- Codrops – BatchedMesh & WebGPURenderer: https://tympanus.net/codrops/2024/10/30/interactive-3d-with-three-js-batchedmesh-and-webgpurenderer/
