import { bootstrapAlert } from "https://cdn.jsdelivr.net/npm/bootstrap-alert@1";
import { DEFAULT_PROMPT, REVEAL_THEMES, escapeHtml, markdownToHtml, update,
  createPresentationHTML, downloadPresentationHTML
} from "./utils.js";

const $ = id => document.getElementById(id);
const $apiKey = $("api-key");
const $modelSelect = $("model-select");
const $themeSelect = $("theme-select");
const $systemPrompt = $("system-prompt");
const $initialTitle = $("initial-title");
const $initialContent = $("initial-content");
const $recordBtn = $("record-btn");
const $prevSlideBtn = $("prev-slide-btn");
const $nextSlideBtn = $("next-slide-btn");
const $openPresentationBtn = $("open-presentation-btn");
const $downloadHtmlBtn = $("download-html-btn");
const $statusIndicator = $("status-indicator");
const $connectionStatus = $("connection-status");
const $slideCount = $("slide-count");
const $currentSlideNum = $("current-slide-num");
const $slidePreview = $("slide-preview");
const $configModal = $("config-modal");
const $configOverlay = $("config-overlay");

let isRecording = false;
let peerConnection = null;
let dataChannel = null;
let mediaStream = null;
let presentationWindow = null;
let slides = [];
let currentSlideIndex = -1;
let responses = {};

const val = el => el.value || el.getAttribute("value");

const saveConfig = () => localStorage.setItem('liveSlidesConfig', JSON.stringify({
  apiKey: $apiKey.value,
  model: $modelSelect.value,
  theme: $themeSelect.value,
  systemPrompt: $systemPrompt.value,
  initialTitle: $initialTitle.value,
  initialContent: $initialContent.value
}));

const loadConfig = () => {
  const config = JSON.parse(localStorage.getItem('liveSlidesConfig') || '{}');
  $apiKey.value = config.apiKey || '';
  $modelSelect.value = config.model || $modelSelect.getAttribute("value");
  $themeSelect.value = config.theme || $themeSelect.getAttribute("value");
  $systemPrompt.value = config.systemPrompt || $systemPrompt.getAttribute("value");
  $initialTitle.value = config.initialTitle || $initialTitle.getAttribute("value");
  $initialContent.value = config.initialContent || $initialContent.getAttribute("value");
};

const updateControlsState = () => {
  const hasKey = !!$apiKey.value.trim();
  $recordBtn.disabled = !hasKey;
  $openPresentationBtn.disabled = !hasKey;
  $downloadHtmlBtn.disabled = !slides.length;
};

const updateStatus = (status, text) => {
  const colors = { disconnected: 'var(--bs-danger)', connecting: 'var(--bs-warning)', connected: 'var(--bs-success)' };
  $statusIndicator.style.background = colors[status];
  $connectionStatus.textContent = text;
};

const updateSlideCount = () => {
  $slideCount.textContent = slides.length;
  $currentSlideNum.textContent = currentSlideIndex >= 0 ? currentSlideIndex + 1 : "-";
};

const updateSlidePreview = () => {
  if (currentSlideIndex < 0) {
    $slidePreview.innerHTML = '<p class="text-muted text-center">No slides yet.</p>';
    return;
  }
  const slide = slides[currentSlideIndex];
  $slidePreview.innerHTML = `
    <h4 class="text-primary">${escapeHtml(slide.title)}</h4>
    <hr>
    <div style="font-size: 0.95rem;">${markdownToHtml(slide.content)}</div>
  `;
};

const syncPresentationSlide = () => {
  if (presentationWindow && !presentationWindow.closed) {
    try { presentationWindow.goToSlide(currentSlideIndex); }
    catch (e) { console.error("Sync error:", e); }
  }
};

const updatePresentationWindow = () => {
  if (!presentationWindow || presentationWindow.closed) return;
  const slide = slides[slides.length - 1];
  try { presentationWindow.addSlide(escapeHtml(slide.title), markdownToHtml(slide.content)); }
  catch (e) { console.error("Update error:", e); }
};

const navigateSlide = direction => {
  const newIndex = currentSlideIndex + direction;
  if (newIndex >= 0 && newIndex < slides.length) {
    currentSlideIndex = newIndex;
    updateSlideCount();
    updateSlidePreview();
    syncPresentationSlide();
    $prevSlideBtn.disabled = currentSlideIndex === 0;
    $nextSlideBtn.disabled = currentSlideIndex === slides.length - 1;
  }
};

const handleAIResponse = responseText => {
  if (!responseText?.trim()) return;

  // Try to extract JSON from the response (handle cases where AI adds extra text)
  let jsonMatch = responseText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.error("No JSON found in response:", responseText);
    bootstrapAlert({ title: "Invalid Response", body: "AI did not return valid JSON.", color: "warning" });
    return;
  }

  try {
    const slideData = JSON.parse(jsonMatch[0]);
    if (!slideData.title || !slideData.content) throw new Error("Invalid JSON structure");

    slides.push({ title: slideData.title, content: slideData.content, timestamp: new Date().toISOString() });
    currentSlideIndex = slides.length - 1;
    updateSlideCount();
    updateSlidePreview();
    updatePresentationWindow();
    updateControlsState();
    $prevSlideBtn.disabled = slides.length <= 1;
    $nextSlideBtn.disabled = true;
    bootstrapAlert({ title: "Slide Created", body: `"${slideData.title}"`, color: "success", timeout: 2000 });
  } catch (e) {
    console.error("Invalid JSON:", jsonMatch[0], e);
    bootstrapAlert({ title: "Invalid Response", body: "AI returned malformed JSON. Check system prompt.", color: "warning" });
  }
};

const setupDataChannel = () => {
  dataChannel.onopen = () => dataChannel.send(JSON.stringify({
    type: "session.update",
    session: {
      modalities: ["text"],
      instructions: val($systemPrompt),
      voice: "alloy",
      turn_detection: { type: "server_vad", threshold: 0.5, prefix_padding_ms: 300, silence_duration_ms: 1000 }
    }
  }));

  dataChannel.onmessage = event => {
    const msg = JSON.parse(event.data);
    const r = responses;

    if (msg.type.match(/^response\.(created|done)$/)) r[msg.response.id] = msg.response;
    else if (msg.type.match(/^response\.output_item\.(added|done)$/)) {
      r[msg.response_id].output = r[msg.response_id].output || [];
      r[msg.response_id].output[msg.output_index] = msg.item;
    }
    else if (msg.type.match(/^response\.content_part\.(added|done)$/)) {
      r[msg.response_id].output[msg.output_index].content = r[msg.response_id].output[msg.output_index].content || [];
      r[msg.response_id].output[msg.output_index].content[msg.content_index] = msg.part;
    }
    else if (msg.type === "response.text.delta") {
      // Accumulate text deltas
      update(r[msg.response_id].output[msg.output_index].content[msg.content_index], "text", msg);
    }
    else if (msg.type === "response.text.done") {
      // Only process when complete
      const fullText = r[msg.response_id].output[msg.output_index].content[msg.content_index].text;
      handleAIResponse(fullText);
    }
    else if (msg.type === "error") {
      console.error("API Error:", msg.error);
      bootstrapAlert({ title: "Error", body: msg.error?.message || "Unknown error", color: "danger" });
    }
  };

  dataChannel.onclose = () => isRecording && stopRecording();
  dataChannel.onerror = () => bootstrapAlert({ title: "Error", body: "Data channel error", color: "danger" });
};

async function startRecording() {
  try {
    updateStatus("connecting", "Connecting...");
    responses = {};
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    peerConnection = new RTCPeerConnection();
    mediaStream.getAudioTracks().forEach(track => peerConnection.addTrack(track, mediaStream));
    dataChannel = peerConnection.createDataChannel("oai-events");
    setupDataChannel();

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    const response = await fetch(`https://api.openai.com/v1/realtime?model=${$modelSelect.value}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${$apiKey.value.trim()}`, "Content-Type": "application/sdp" },
      body: offer.sdp
    });

    if (!response.ok) throw new Error(`API Error: ${response.status}`);
    await peerConnection.setRemoteDescription({ type: "answer", sdp: await response.text() });

    isRecording = true;
    $recordBtn.classList.add("btn-danger", "recording");
    $recordBtn.classList.remove("btn-outline-danger");
    $recordBtn.querySelector("span").textContent = "Stop Recording";
    $recordBtn.querySelector("i").className = "bi bi-stop-circle me-2";
    updateStatus("connected", "Connected");
    if (!presentationWindow || presentationWindow.closed) openPresentationWindow();
  } catch (error) {
    bootstrapAlert({ title: "Failed", body: error.message, color: "danger" });
    cleanup();
    updateStatus("disconnected", "Failed");
  }
}

function stopRecording() {
  isRecording = false;
  dataChannel?.close();
  peerConnection?.close();
  mediaStream?.getTracks().forEach(t => t.stop());
  $recordBtn.classList.remove("btn-danger", "recording");
  $recordBtn.classList.add("btn-outline-danger");
  $recordBtn.querySelector("span").textContent = "Start Recording";
  $recordBtn.querySelector("i").className = "bi bi-record-circle me-2";
  updateStatus("disconnected", "Disconnected");
  updateControlsState();
}

function openPresentationWindow() {
  if (presentationWindow && !presentationWindow.closed) return presentationWindow.focus();

  const themeFile = REVEAL_THEMES[val($themeSelect)];
  const html = createPresentationHTML(slides, val($initialTitle), val($initialContent), themeFile);
  const [width, height] = [800, 600];

  presentationWindow = window.open("", "LiveSlidesPresentation",
    `width=${width},height=${height},left=${(screen.width - width) / 2},top=${(screen.height - height) / 2},scrollbars=no,resizable=yes`
  );

  if (!presentationWindow) return bootstrapAlert({ title: "Popup Blocked", body: "Allow popups for this site.", color: "warning" });
  presentationWindow.document.write(html);
  presentationWindow.document.close();
  presentationWindow.onload = syncPresentationSlide;
}

const downloadSlides = () => {
  downloadPresentationHTML(slides, val($initialTitle), val($initialContent), REVEAL_THEMES[val($themeSelect)]);
  bootstrapAlert({ title: "Downloaded", body: "Presentation downloaded successfully!", color: "success" });
};

const cleanup = stopRecording;

// Modal Controls
$("config-btn").onclick = () => { $configModal.classList.add("show"); $configOverlay.classList.add("show"); };
$("close-config-btn").onclick = $configOverlay.onclick = () => { $configModal.classList.remove("show"); $configOverlay.classList.remove("show"); };
$("save-config-btn").onclick = () => {
  saveConfig();
  bootstrapAlert({ title: "Saved", body: "Configuration saved successfully.", color: "success" });
  $configModal.classList.remove("show");
  $configOverlay.classList.remove("show");
  updateControlsState();
};

// Event Listeners
$apiKey.oninput = () => { saveConfig(); updateControlsState(); };
$modelSelect.onchange = $themeSelect.onchange = $systemPrompt.oninput = $initialTitle.oninput = $initialContent.oninput = saveConfig;
$recordBtn.onclick = () => isRecording ? stopRecording() : startRecording();
$prevSlideBtn.onclick = () => navigateSlide(-1);
$nextSlideBtn.onclick = () => navigateSlide(1);
$openPresentationBtn.onclick = openPresentationWindow;
$downloadHtmlBtn.onclick = downloadSlides;
window.onbeforeunload = () => { cleanup(); presentationWindow?.close(); };

// Initialize
loadConfig();
updateControlsState();
