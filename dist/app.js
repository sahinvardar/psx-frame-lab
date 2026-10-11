"use strict";
const $ = (id) => document.getElementById(id),
  canvas = $("screen"),
  ctx = canvas.getContext("2d"),
  vc = $("vram").getContext("2d"),
  fc = $("final").getContext("2d");
const imageCanvas = document.createElement("canvas");
imageCanvas.width = 1024;
imageCanvas.height = 512;
const imageCtx = imageCanvas.getContext("2d");
const finalCanvas = document.createElement("canvas");
finalCanvas.width = 1024;
finalCanvas.height = 512;
const finalCtx = finalCanvas.getContext("2d");
const highCanvas = document.createElement("canvas"),
  highFinalCanvas = document.createElement("canvas");
let highScale = 1,
  highReady = false,
  resolutionPending = false;
function updateHighResolutionCanvas(canvas, data) {
  if (!data) return;
  canvas.width = data.width;
  canvas.height = data.height;
  canvas
    .getContext("2d")
    .putImageData(new ImageData(data.pixels, data.width, data.height), 0, 0);
}
let worker = null,
  commands = [],
  info = {},
  current = 0,
  desired = 0,
  currentState = null,
  finalState = null,
  currentRaw = null,
  textureRaw = null,
  mode = "frame",
  request = 0,
  busy = false,
  playing = false,
  timer = null,
  view = { zoom: 1, x: 0, y: 0, yaw: 0, pitch: 0 },
  listNodes = new Map(),
  name = "",
  drag = null,
  ready = false;
const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
function showNotice(message, error = false) {
  $("notice").textContent = message;
  $("notice").classList.toggle("error", error);
}
function setReady(value) {
  ready = value;
  for (const id of [
    "start",
    "prev",
    "prevDraw",
    "play",
    "next",
    "nextDraw",
    "end",
    "timeline",
    "stepNumber",
    "resolution",
    "exportVram",
    "exportFinal",
  ])
    $(id).disabled = !value;
}
setReady(false);
function stopPlayback() {
  playing = false;
  clearTimeout(timer);
  $("play").textContent = "▶";
}
function createReplayWorker() {
  if (worker) worker.terminate();
  const workerURL = window.PSX_WORKER_SOURCE
    ? URL.createObjectURL(
        new Blob([window.PSX_WORKER_SOURCE], { type: "text/javascript" }),
      )
    : "worker.js";
  worker = new Worker(workerURL);
  if (window.PSX_WORKER_SOURCE) URL.revokeObjectURL(workerURL);
  worker.onmessage = ({ data: m }) => {
    if (m.type === "progress") showNotice(m.text);
    else if (m.type === "error") {
      busy = false;
      $("resolution").disabled = false;
      stopPlayback();
      setReady(false);
      showNotice(m.text, true);
    } else if (m.type === "loaded") {
      highScale = 1;
      highReady = false;
      resolutionPending = false;
      $("resolution").value = "1";
      commands = m.commands;
      info = m.info;
      currentState = m.state;
      finalState = PSX.clone(m.state);
      currentRaw = m.raw;
      textureRaw = m.textureRaw || null;
      imageCtx.putImageData(new ImageData(m.pixels, 1024, 512), 0, 0);
      finalCtx.drawImage(imageCanvas, 0, 0);
      current = desired = commands.length;
      busy = false;
      $("filename").textContent = name;
      $("filemeta").textContent = [
        info.game || "Unknown game",
        info.video || "",
        (m.bytes / 1048576).toFixed(2) + " MB decoded",
      ]
        .filter(Boolean)
        .join(" · ");
      const draws = commands.filter((c) =>
        ["polygon", "rectangle", "line"].includes(c.kind),
      ).length;
      $("countBadge").textContent = draws.toLocaleString() + " DRAW COMMANDS";
      $("setupInfo").textContent =
        m.setup.length + " setup commands restored before step 1";
      $("interval").replaceChildren(new Option("All intervals", "all"));
      [...new Set(commands.map((c) => c.frame))].forEach((f) =>
        $("interval").add(new Option("Interval " + f, f)),
      );
      $("timeline").max = commands.length;
      $("stepNumber").max = commands.length;
      $("total").textContent = "/ " + commands.length;
      $("emptyScreen").hidden = true;
      $("search").value = "";
      $("filter").value = "all";
      setReady(true);
      resetView();
      buildCommandList();
      updateSelectedCommand();
      renderAll();
      showNotice(
        m.warnings.length
          ? m.warnings.join(" · ")
          : "Capture ready. Select a command or drag the timeline. Frame rendering is approximate; geometry depth is illustrative.",
      );
      window.lab = {
        get commands() {
          return commands;
        },
        get current() {
          return current;
        },
        get state() {
          return currentState;
        },
        get raw() {
          return currentRaw;
        },
        seek,
        loadBuffer,
      };
    } else if (m.type === "resolution") {
      busy = false;
      highScale = m.scale;
      highReady = !!m.high;
      updateHighResolutionCanvas(highCanvas, m.high);
      updateHighResolutionCanvas(highFinalCanvas, m.finalHigh);
      $("resolution").disabled = false;
      renderAll();
      showNotice(
        "Replay resolution: " +
          highScale +
          "×. Textures and VRAM retain native PS1 detail.",
      );
      if (resolutionPending) changeResolution();
      else if (desired !== current) requestSeek();
    } else if (m.type === "frame") {
      busy = false;
      if (m.high) {
        updateHighResolutionCanvas(highCanvas, m.high);
        highReady = true;
      }
      current = m.n;
      currentState = m.state;
      currentRaw = m.raw;
      textureRaw = m.textureRaw || null;
      imageCtx.putImageData(new ImageData(m.pixels, 1024, 512), 0, 0);
      updateSelectedCommand();
      renderAll();
      if (resolutionPending) changeResolution();
      else if (desired !== current) requestSeek();
      else if (playing) schedulePlayback();
    }
  };
  worker.onerror = (e) => {
    stopPlayback();
    setReady(false);
    showNotice("Replay worker failed: " + e.message, true);
  };
}
function loadBuffer(buffer, filename) {
  stopPlayback();
  name = filename;
  setReady(false);
  busy = true;
  commands = [];
  listNodes.clear();
  current = desired = 0;
  createReplayWorker();
  showNotice("Reading " + filename + "…");
  worker.postMessage({ type: "load", buffer }, [buffer]);
}
async function loadFile(file) {
  if (!file) return;
  if (file.size > 64 * 1048576) {
    showNotice("Please choose a file smaller than 64 MB.", true);
    return;
  }
  if (file.name.toLowerCase().endsWith(".xz")) {
    showNotice(
      "Please decompress this XZ file first. Raw .psxgpu and .psxgpu.zst are supported.",
      true,
    );
    return;
  }
  try {
    loadBuffer(await file.arrayBuffer(), file.name);
  } catch (e) {
    showNotice(e.message, true);
  }
}
$("file").onchange = (e) => {
  loadFile(e.target.files[0]);
  e.target.value = "";
};
let dragDepth = 0;
window.addEventListener("dragenter", (e) => {
  if (e.dataTransfer.types.includes("Files")) {
    e.preventDefault();
    dragDepth++;
    document.body.classList.add("dragging");
  }
});
window.addEventListener("dragleave", () => {
  if (--dragDepth <= 0) {
    dragDepth = 0;
    document.body.classList.remove("dragging");
  }
});
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => {
  e.preventDefault();
  dragDepth = 0;
  document.body.classList.remove("dragging");
  loadFile(e.dataTransfer.files[0]);
});
function requestSeek() {
  if (busy || !ready) return;
  busy = true;
  worker.postMessage({ type: "seek", n: desired, request: ++request });
}
function seek(n) {
  if (!ready) return;
  desired = Math.min(commands.length, Math.max(0, Math.round(Number(n) || 0)));
  $("timeline").value = desired;
  $("stepNumber").value = desired;
  if (desired !== current) requestSeek();
}
function schedulePlayback() {
  clearTimeout(timer);
  if (desired >= commands.length) {
    stopPlayback();
    return;
  }
  timer = setTimeout(() => seek(desired + Number($("speed").value)), 100);
}
function togglePlay() {
  if (!ready) return;
  if (playing) {
    stopPlayback();
    return;
  }
  playing = true;
  $("play").textContent = "Ⅱ";
  if (current === commands.length) seek(0);
  else schedulePlayback();
}
$("play").onclick = togglePlay;
$("prev").onclick = () => {
  stopPlayback();
  seek(desired - 1);
};
$("next").onclick = () => {
  stopPlayback();
  seek(desired + 1);
};
$("start").onclick = () => {
  stopPlayback();
  seek(0);
};
$("end").onclick = () => {
  stopPlayback();
  seek(commands.length);
};
function jumpToDrawingCommand(direction) {
  stopPlayback();
  let index = direction > 0 ? desired : desired - 2;
  for (; index >= 0 && index < commands.length; index += direction) {
    if (
      ["polygon", "rectangle", "line", "fill"].includes(commands[index].kind)
    ) {
      seek(index + 1);
      return;
    }
  }
  seek(direction > 0 ? commands.length : 0);
}
$("prevDraw").onclick = () => jumpToDrawingCommand(-1);
$("nextDraw").onclick = () => jumpToDrawingCommand(1);
$("timeline").oninput = (e) => {
  stopPlayback();
  seek(e.target.value);
};
$("stepNumber").onfocus = stopPlayback;
$("stepNumber").oninput = stopPlayback;
$("stepNumber").onchange = (e) => {
  stopPlayback();
  seek(e.target.value);
};
$("stepNumber").onkeydown = (e) => {
  if (e.key === "Enter") {
    stopPlayback();
    seek(e.target.value);
    e.target.blur();
  }
};
window.addEventListener("keydown", (e) => {
  if (["INPUT", "SELECT", "TEXTAREA", "BUTTON"].includes(e.target.tagName))
    return;
  const f = {
    ArrowLeft: () => seek(desired - 1),
    ArrowRight: () => seek(desired + 1),
    Home: () => seek(0),
    End: () => seek(commands.length),
    " ": togglePlay,
  }[e.key];
  if (f) {
    e.preventDefault();
    if (e.key !== " ") stopPlayback();
    f();
  }
});
function buildCommandList() {
  const query = $("search").value.toLowerCase(),
    filter = $("filter").value,
    interval = $("interval").value;
  const fragment = document.createDocumentFragment();
  listNodes.clear();
  let count = 0;
  commands.forEach((command, index) => {
    if (interval !== "all" && command.frame !== +interval) return;
    if (
      filter === "draw" &&
      !["polygon", "rectangle", "line", "fill"].includes(command.kind)
    )
      return;
    if (filter === "state" && !["state", "control"].includes(command.kind))
      return;
    if (["transfer", "event"].includes(filter) && command.kind !== filter)
      return;
    if (
      query &&
      !`${index + 1} ${command.name} ${command.port} ${command.op.toString(16)} ${command.raw.join(" ")}`
        .toLowerCase()
        .includes(query)
    )
      return;
    count++;
    const element = document.createElement("button");
    element.className = "cmd";
    element.innerHTML = `<span class="num">${String(index + 1).padStart(4, "0")}</span><span class="kind ${command.kind}"></span><span><span class="name">${esc(command.name)}</span><div class="meta">${command.port} ${command.port === "Event" ? "" : command.op.toString(16).toUpperCase().padStart(2, "0")} · INTERVAL ${command.frame}</div></span>`;
    element.onclick = () => {
      stopPlayback();
      seek(index + 1);
    };
    fragment.append(element);
    listNodes.set(index + 1, element);
  });
  $("commandList").replaceChildren(fragment);
  if (!count) {
    const emptyMessage = document.createElement("div");
    emptyMessage.className = "empty";
    emptyMessage.textContent = "No matching commands";
    $("commandList").append(emptyMessage);
  }
  $("listCount").textContent = count.toLocaleString();
  updateSelectedCommand(false);
}
for (const id of ["search", "filter", "interval"])
  $(id).addEventListener(
    id === "search" ? "input" : "change",
    buildCommandList,
  );
function updateSelectedCommand(scroll = true) {
  $("timeline").value = current;
  $("stepNumber").value = current;
  for (const [n, el] of listNodes) {
    el.classList.toggle("active", n === current);
    el.setAttribute("aria-current", n === current ? "step" : "false");
  }
  if (scroll) {
    const el = listNodes.get(current);
    if (el) {
      const box = $("commandList");
      if (
        el.offsetTop < box.scrollTop ||
        el.offsetTop + el.offsetHeight > box.scrollTop + box.clientHeight
      )
        box.scrollTop = el.offsetTop - box.offsetTop - box.clientHeight / 2;
    }
  }
  const c = commands[current - 1];
  $("stepTitle").textContent = c ? c.name : "Initial GPU state";
  $("opBadge").textContent = c
    ? c.port + (c.port === "Event" ? "" : " " + c.op.toString(16).toUpperCase())
    : "SETUP";
  showDetails(c);
}
function renderDefinitionList(entries) {
  return (
    "<dl>" +
    entries.map(([a, b]) => `<dt>${esc(a)}</dt><dd>${esc(b)}</dd>`).join("") +
    "</dl>"
  );
}
function showDetails(c) {
  if (!currentState) return;
  const s = currentState;
  let html = c ? `<h3>${esc(c.name)}</h3>` : "<h3>Restored initial state</h3>";
  if (c)
    html += renderDefinitionList([
      ["Command", current + " / " + commands.length],
      ["Interval", c.frame],
      ["File offset", "0x" + c.offset.toString(16).toUpperCase()],
      ["Length", c.wordCount + " words"],
    ]);
  if (c?.clut) {
    html +=
      '<section class="texturePreview"><h4>TEXTURE IN USE</h4><div class="textureCropWrap"><canvas id="textureCrop" aria-label="Decoded texture used by the selected command"></canvas></div><p id="textureCaption"></p><details><summary>Full texture page + UV outline</summary><div class="texturePageWrap"><canvas id="texturePage" width="256" height="256" aria-label="Decoded texture page with selected UV outline"></canvas></div></details><p class="textureNote">Before this command · original texture colors · checkerboard = transparent</p></section>';
  }
  if (c?.v?.length) {
    html += "<h4>VERTICES · BEFORE DRAW OFFSET</h4>";
    c.v.forEach(
      (v, i) =>
        (html += `<div class="vertex"><b>V${i}</b> x ${v.xy[0]} &nbsp; y ${v.xy[1]}<br><span class="swatch" style="background:rgb(${v.rgb.join(",")})"></span>RGB ${v.rgb.join(", ")}${v.uv ? "<br>UV " + v.uv.join(", ") : ""}</div>`),
    );
  }
  if (c?.port === "Event" && c.op === 2) {
    const lo = parseInt(c.raw[0] || "0", 16),
      hi = parseInt(c.raw[1] || "0", 16);
    html +=
      "<h4>SYNC TIMING</h4>" +
      renderDefinitionList([
        ["CPU cycles", (BigInt(hi) * 4294967296n + BigInt(lo)).toString()],
      ]);
  }
  if (c?.clut) {
    html +=
      "<h4>TEXTURE CONTEXT</h4>" +
      renderDefinitionList([
        ["Palette", c.clut.join(", ")],
        ["Page origin", c.page.x + ", " + c.page.y],
        [
          "Color depth",
          ["4-bit indexed", "8-bit indexed", "15-bit direct", "Reserved"][
            c.page.depth
          ],
        ],
        ["Texture color", c.rawTexture ? "Raw" : "Modulated"],
        ["Transparency", c.semi ? "Enabled" : "Opaque"],
      ]);
  }
  html +=
    "<h4>GPU STATE AFTER THIS STEP</h4>" +
    renderDefinitionList([
      [
        "Draw area",
        s.area.slice(0, 2).join(", ") + " → " + s.area.slice(2).join(", "),
      ],
      ["Draw offset", s.offset.join(", ")],
      ["Display origin", s.display.join(", ")],
      ["Display size", s.resolution.join(" × ")],
      ["Dithering", s.dither ? "On" : "Off"],
      ["Mask write / test", Number(s.maskSet) + " / " + Number(s.maskCheck)],
    ]);
  if (c)
    html +=
      '<h4>RAW COMMAND WORDS</h4><div class="raw">' +
      c.raw.join(" ") +
      (c.wordCount > c.raw.length
        ? "\n… " + (c.wordCount - c.raw.length) + " more payload words"
        : "") +
      "</div>";
  $("details").innerHTML = html;
  renderTexturePreview(c);
}
function renderTexturePreview(c) {
  const crop = $("textureCrop"),
    page = $("texturePage");
  if (!crop || !page) return;
  const preview = PSX.texturePreview(textureRaw, c);
  if (!preview) {
    $("textureCaption").textContent = "Texture data unavailable at this step.";
    return;
  }
  crop.width = preview.width;
  crop.height = preview.height;
  crop
    .getContext("2d")
    .putImageData(
      new ImageData(preview.crop, preview.width, preview.height),
      0,
      0,
    );
  const pc = page.getContext("2d");
  pc.putImageData(new ImageData(preview.page, 256, 256), 0, 0);
  // Wrap-aware rectangular UV ranges use a crop; the page overlay stays in its 0–255 coordinate system.
  const order =
    preview.uv.length === 4 ? [0, 1, 3, 2] : preview.uv.map((_, i) => i);
  pc.beginPath();
  order.forEach((n, i) => {
    const [u, v] = preview.uv[n];
    i ? pc.lineTo(u + 0.5, v + 0.5) : pc.moveTo(u + 0.5, v + 0.5);
  });
  pc.closePath();
  pc.strokeStyle = "#111";
  pc.lineWidth = 3;
  pc.stroke();
  pc.strokeStyle = "#bbf76b";
  pc.lineWidth = 1;
  pc.stroke();
  for (const [u, v] of preview.uv) {
    pc.fillStyle = "#bbf76b";
    pc.fillRect(u - 1, v - 1, 3, 3);
  }
  $("textureCaption").textContent =
    `UV bounds ${preview.width} × ${preview.height} · (${preview.left}, ${preview.top})` +
    (preview.windowed ? " · texture window applied" : "");
}
function getRenderRegion(state) {
  if ($("target").value === "display")
    return [
      state.display[0],
      state.display[1],
      state.resolution[0],
      state.resolution[1],
    ];
  let [x, y, x2, y2] = state.area;
  return [x, y, Math.max(1, x2 - x + 1), Math.max(1, y2 - y + 1)];
}
function resetView() {
  view = {
    zoom: 1,
    x: 0,
    y: 0,
    yaw: mode === "geometry" ? -0.35 : 0,
    pitch: mode === "geometry" ? 0.25 : 0,
  };
  renderScreen();
}
$("fit").onclick = resetView;
$("target").onchange = () => {
  resetView();
  if (highScale > 1) changeResolution();
  else renderAll();
};
$("resolution").onchange = changeResolution;
$("overlays").onchange = renderVram;
$("spread").oninput = renderScreen;
$("wire").onchange = renderScreen;
function setMode(m) {
  mode = m;
  $("frameMode").classList.toggle("active", m === "frame");
  $("geometryMode").classList.toggle("active", m === "geometry");
  $("geometryControls").hidden = m !== "geometry";
  $("cameraHint").textContent =
    m === "frame"
      ? "Drag to pan · Scroll to zoom"
      : "Drag to orbit · Shift-drag / right-drag to pan · Scroll to zoom";
  resetView();
}
$("frameMode").onclick = () => setMode("frame");
$("geometryMode").onclick = () => setMode("geometry");
function changeResolution() {
  if (!ready) return;
  stopPlayback();
  if (busy) {
    resolutionPending = true;
    return;
  }
  resolutionPending = false;
  busy = true;
  highReady = false;
  $("resolution").disabled = true;
  worker.postMessage({
    type: "resolution",
    scale: Number($("resolution").value),
    target: $("target").value,
    n: current,
  });
}
function renderAll() {
  renderScreen();
  renderVram();
  renderFinal();
}
function renderScreen() {
  const r = canvas.getBoundingClientRect(),
    dpr = Math.min(devicePixelRatio || 1, 2);
  if (
    canvas.width !== Math.round(r.width * dpr) ||
    canvas.height !== Math.round(r.height * dpr)
  ) {
    canvas.width = Math.round(r.width * dpr);
    canvas.height = Math.round(r.height * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = "#0a0e10";
  ctx.fillRect(0, 0, r.width, r.height);
  if (!currentState) return;
  if (mode === "geometry") {
    renderGeometry(r.width, r.height);
    return;
  }
  const [x, y, w, h] = getRenderRegion(currentState),
    scale = Math.min((r.width - 32) / w, (r.height - 50) / h) * view.zoom,
    ox = (r.width - w * scale) / 2 + view.x,
    oy = (r.height - h * scale) / 2 + view.y;
  $("currentResolution").textContent =
    w * highScale + " × " + h * highScale + " · " + highScale + "×";
  ctx.imageSmoothingEnabled = false;
  if (highReady) ctx.drawImage(highCanvas, ox, oy, w * scale, h * scale);
  else ctx.drawImage(imageCanvas, x, y, w, h, ox, oy, w * scale, h * scale);
  ctx.strokeStyle = "#3a474b";
  ctx.lineWidth = 1;
  ctx.strokeRect(ox - 0.5, oy - 0.5, w * scale + 1, h * scale + 1);
  const c = commands[current - 1];
  if (c?.v?.length) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(ox, oy, w * scale, h * scale);
    ctx.clip();
    ctx.strokeStyle = "#c8ff83";
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    let order = c.v.length === 4 ? [0, 1, 3, 2] : c.v.map((_, i) => i);
    order.forEach((j, i) => {
      const v = c.v[j],
        px = ox + (v.xy[0] + c.drawOffset[0] - x) * scale,
        py = oy + (v.xy[1] + c.drawOffset[1] - y) * scale;
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    });
    if (c.kind === "polygon") ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }
}
function renderGeometry(width, height) {
  const [rx, ry, rw, rh] = getRenderRegion(currentState),
    spread = +$("spread").value * 1.8,
    sc = Math.min((width - 30) / rw, (height - 40) / rh) * view.zoom,
    cy = Math.cos(view.yaw),
    sy = Math.sin(view.yaw),
    cp = Math.cos(view.pitch),
    sp = Math.sin(view.pitch);
  function project(x, y, z) {
    let xx = x * cy + z * sy,
      zz = -x * sy + z * cy,
      yy = y * cp - zz * sp;
    zz = y * sp + zz * cp;
    const perspective = 650 / Math.max(100, 650 + zz);
    return [
      width / 2 + view.x + xx * sc * perspective,
      height / 2 + view.y + yy * sc * perspective,
      zz,
    ];
  }
  const shapes = [];
  let drawn = 0;
  for (let i = 0; i < current; i++) {
    const c = commands[i];
    if (c.kind !== "polygon") continue;
    const points = c.v.map((v) =>
      project(
        v.xy[0] + c.drawOffset[0] - rx - rw / 2,
        v.xy[1] + c.drawOffset[1] - ry - rh / 2,
        (i / Math.max(1, commands.length) - 0.5) * spread,
      ),
    );
    let rgb = c.v[0].rgb.map((_, j) =>
      Math.round(c.v.reduce((s, v) => s + v.rgb[j], 0) / c.v.length),
    );
    shapes.push({
      points,
      c,
      index: i,
      color: `rgb(${rgb.join(",")})`,
      z: points.reduce((s, p) => s + p[2], 0) / points.length,
    });
    drawn++;
  }
  ctx.strokeStyle = "#263236";
  ctx.lineWidth = 1;
  for (let j = -3; j <= 3; j++) {
    let a = project(j * 100, -300, -spread / 2),
      b = project(j * 100, 300, -spread / 2);
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.stroke();
    a = project(-400, j * 100, -spread / 2);
    b = project(400, j * 100, -spread / 2);
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.stroke();
  }
  shapes.sort((a, b) => b.z - a.z || a.index - b.index);
  for (const shape of shapes) {
    const p = shape.points,
      order = p.length === 4 ? [0, 1, 3, 2] : [0, 1, 2];
    ctx.beginPath();
    order.forEach((j, i) =>
      i ? ctx.lineTo(p[j][0], p[j][1]) : ctx.moveTo(p[j][0], p[j][1]),
    );
    ctx.closePath();
    ctx.fillStyle = shape.color;
    ctx.globalAlpha = shape.c.semi ? 0.5 : 0.9;
    ctx.fill();
    ctx.globalAlpha = 1;
    if ($("wire").checked || shape.index === current - 1) {
      ctx.strokeStyle = shape.index === current - 1 ? "#d7ff9d" : "#10191e99";
      ctx.lineWidth = shape.index === current - 1 ? 2 : 0.6;
      ctx.stroke();
    }
  }
  $("currentResolution").textContent =
    drawn.toLocaleString() + " POLYGONS · VERTEX COLORS";
}
function renderVram() {
  if (!currentState) return;
  vc.drawImage(imageCanvas, 0, 0);
  if (!$("overlays").checked) return;
  const a = currentState.area;
  vc.lineWidth = 2;
  vc.strokeStyle = "#bbf76b";
  vc.strokeRect(a[0] + 1, a[1] + 1, a[2] - a[0] - 1, a[3] - a[1] - 1);
  const c = commands[current - 1];
  if (c?.clut) {
    vc.strokeStyle = "#65bdff";
    vc.strokeRect(
      c.page.x + 1,
      c.page.y + 1,
      c.page.depth === 0 ? 62 : c.page.depth === 1 ? 126 : 254,
      254,
    );
    vc.strokeStyle = "#ed8fca";
    vc.lineWidth = 3;
    vc.strokeRect(c.clut[0], c.clut[1], c.page.depth === 0 ? 16 : 256, 2);
  }
}
function renderFinal() {
  if (!finalState) return;
  const [x, y, w, h] = getRenderRegion(finalState);
  $("final").width = w * highScale;
  $("final").height = h * highScale;
  fc.imageSmoothingEnabled = false;
  if (highReady) fc.drawImage(highFinalCanvas, 0, 0);
  else
    fc.drawImage(finalCanvas, x, y, w, h, 0, 0, w * highScale, h * highScale);
  $("finalCaption").textContent =
    "Complete capture · " +
    ($("target").value === "draw" ? "draw target" : "display buffer") +
    " · " +
    w * highScale +
    " × " +
    h * highScale;
}
$("vram").onmousemove = (e) => {
  if (!currentRaw) return;
  const r = e.target.getBoundingClientRect(),
    x = Math.min(1023, Math.floor(((e.clientX - r.left) / r.width) * 1024)),
    y = Math.min(511, Math.floor(((e.clientY - r.top) / r.height) * 512)),
    v = currentRaw[y * 1024 + x];
  $("pixelInfo").textContent =
    `(${x}, ${y}) · 0x${v.toString(16).padStart(4, "0").toUpperCase()} · RGB5 ${v & 31},${(v >> 5) & 31},${(v >> 10) & 31} · mask ${v >>> 15}`;
};
canvas.oncontextmenu = (e) => e.preventDefault();
canvas.onpointerdown = (e) => {
  if (!ready) return;
  canvas.setPointerCapture(e.pointerId);
  drag = {
    x: e.clientX,
    y: e.clientY,
    pan: mode === "frame" || e.shiftKey || e.button === 2,
  };
};
canvas.onpointermove = (e) => {
  if (!drag) return;
  let dx = e.clientX - drag.x,
    dy = e.clientY - drag.y;
  drag.x = e.clientX;
  drag.y = e.clientY;
  if (drag.pan) {
    view.x += dx;
    view.y += dy;
  } else {
    view.yaw += dx * 0.008;
    view.pitch = Math.max(-1.5, Math.min(1.5, view.pitch + dy * 0.008));
  }
  renderScreen();
};
canvas.onpointerup = canvas.onpointercancel = () => (drag = null);
canvas.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    view.zoom = Math.max(
      0.15,
      Math.min(12, view.zoom * Math.exp(-e.deltaY * 0.001)),
    );
    renderScreen();
  },
  { passive: false },
);
new ResizeObserver(renderScreen).observe($("screenWrap"));
function savePNG(c, filename) {
  if (!ready) return;
  c.toBlob((blob) => {
    const url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
}
$("exportVram").onclick = () =>
  savePNG(imageCanvas, "psx-vram-step-" + current + ".png");
$("exportFinal").onclick = () => savePNG($("final"), "psx-final-frame.png");
function demoCapture() {
  const parts = [],
    packet = (t, w) => {
      const a = new Uint32Array(w.length + 1);
      a[0] = (t << 24) | w.length;
      a.set(w, 1);
      parts.push(a);
    },
    p0 = (w) => packet(0, w),
    packXY = (x, y) => (x & 65535) | ((y & 65535) << 16),
    col = (r, g, b) => r | (g << 8) | (b << 16);
  const vram = new Uint16Array(1024 * 512);
  for (let y = 0; y < 128; y++)
    for (let x = 0; x < 128; x++) {
      const on = ((x >> 3) ^ (y >> 3)) & 1;
      vram[y * 1024 + 640 + x] =
        (on ? 12 : 3) | ((on ? 29 : 10) << 5) | ((on ? 24 : 12) << 10);
    }
  // Tiny 4-bit indexed checkerboard plus its 16-entry palette.
  for (let y = 0; y < 256; y++)
    for (let x = 0; x < 64; x++) {
      let z = 0;
      for (let q = 0; q < 4; q++)
        z |= (((((x * 4 + q) >> 4) ^ (y >> 4)) % 15) + 1) << (q * 4);
      vram[(y + 256) * 1024 + 640 + x] = z;
    }
  for (let i = 0; i < 16; i++)
    vram[480 * 1024 + 640 + i] =
      i | (Math.min(31, i * 2) << 5) | ((31 - i) << 10);
  const upload = new Uint32Array(3 + vram.length / 2);
  upload[0] = 0xa0000000;
  upload.set(new Uint32Array(vram.buffer), 3);
  p0(upload);
  p0([0xe3000000, 0xe4000000 | 511 | (239 << 10), 0xe5000000, 0xe1000200]);
  packet(1, [0x08000002, 0x05000000]);
  packet(5, []);
  p0([0x02000000 | col(15, 25, 29), 0, packXY(512, 240)]);
  for (let y = 0; y < 6; y++)
    for (let x = 0; x < 16; x++) {
      let xx = x * 32,
        yy = 128 + y * 18;
      p0([
        0x30000000 | col(24 + y * 5, 45 + y * 5, 48 + y * 5),
        packXY(xx, yy),
        col(38, 69, 67),
        packXY(xx + 32, yy),
        col(21, 34, 43),
        packXY(xx + 16, yy + 18),
      ]);
    }
  const rings = [
      [256, 37],
      [348, 120],
      [256, 211],
      [164, 120],
    ],
    center = [256, 116];
  for (let j = 0; j < 4; j++) {
    let a = rings[j],
      b = rings[(j + 1) % 4];
    p0([
      0x30000000 | col(188 - j * 25, 244 - j * 25, 112 + j * 20),
      packXY(...a),
      col(36 + j * 30, 125 + j * 20, 134),
      packXY(...b),
      col(140, 208, 86),
      packXY(...center),
    ]);
  }
  // Textured quad, 4-bit indexed at (640,256), palette (640,480).
  p0([
    0x2c808080,
    packXY(25, 22),
    ((640 / 16) | (480 << 6)) << 16,
    packXY(121, 22),
    127 | ((10 | 16) << 16),
    packXY(25, 110),
    127 << 8,
    packXY(121, 110),
    127 | (127 << 8),
  ]);
  packet(2, [566208]);
  p0([0xe6000000]);
  packet(2, [1132416]);
  let size = 14 + parts.reduce((n, a) => n + a.byteLength, 0),
    bytes = new Uint8Array(size);
  bytes.set(new TextEncoder().encode("PSXGPUDUMPv1\0\0"));
  let at = 14;
  const dv = new DataView(bytes.buffer);
  for (const a of parts)
    for (const v of a) {
      dv.setUint32(at, v, true);
      at += 4;
    }
  return bytes.buffer;
}
$("demo").onclick = $("demoCenter").onclick = () =>
  loadBuffer(demoCapture(), "Frame Lab · synthetic demo.psxgpu");
// Public helper is browser-local and also used by the verification harness.
window.loadDumpBuffer = loadBuffer;
window.createDemoCapture = demoCapture;
