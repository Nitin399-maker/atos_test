// utils.js

// Constants
export const DEFAULT_PROMPT = `You are a presentation slide generator.
Listen to the user's speech and when they pause or have spoken 20-30 words, generate a slide summarizing what they just said.

Return ONLY a JSON object with this exact format:
{"title": "Short Title 📌", "content": "- Point 1\n- Point 2\n• Point 3"}

Rules:
- Title: 3-10 words that summarizes the message. Optional emoji
- Content: 2-4 bullet points or paragraphs, <=200 chars. Proves the title`;

export const REVEAL_THEMES = {
  league: "league.css",
  black: "black.css",
  white: "white.css",
  moon: "moon.css",
  sky: "sky.css",
  serif: "serif.css",
  beige: "beige.css"
};

// Escape HTML to prevent XSS
export const escapeHtml = text => {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
};

// Convert markdown to HTML
export const markdownToHtml = md => {
  return md
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/^• (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/^(?!<[hul])/gm, '<p>')
    .replace(/(?<![>])$/gm, '</p>')
    .replace(/<p><\/p>/g, '')
    .replace(/<p>(<[hul])/g, '$1')
    .replace(/(<\/[hul][^>]*>)<\/p>/g, '$1');
};

// Helper function to update nested response objects
export function update(node, key, object) {
  if (object.delta) node[key] = (node[key] ?? "") + object.delta;
  else if (object[key]) node[key] = object[key];
}

// Create presentation HTML
export function createPresentationHTML(slides, initialTitle, initialContent, themeFile) {
  const slidesHTML = slides.length > 0
    ? slides.map(s => {
        const htmlContent = markdownToHtml(s.content);
        return `<section><h2>${escapeHtml(s.title)}</h2><div class="slide-content">${htmlContent}</div></section>`;
      }).join('')
    : `<section><h2>${escapeHtml(initialTitle)}</h2><p>${escapeHtml(initialContent)}</p></section>`;

  return `<!DOCTYPE html>
<html><head><title>Live Presentation</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js@4.5.0/dist/reset.css">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js@4.5.0/dist/reveal.css">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js@4.5.0/dist/theme/${themeFile}" id="theme-link">
<style>
.reveal{font-size:33px}
.reveal h2{font-size:2em;margin-bottom:.6em;font-weight:bold;line-height:1.2}
.reveal .slide-content{font-size:1.3em;line-height:1.6;text-align:left;padding:0 40px;max-width:100%;word-wrap:break-word}
.reveal section{text-align:center;padding:40px 20px;height:100%;display:flex;flex-direction:column;justify-content:center;align-items:center}
.reveal ul,.reveal ol{margin:0;padding:0;list-style-position:inside;text-align:left;width:100%}
.reveal li{margin-bottom:.4em;line-height:1.5}
</style></head><body>
<div class="reveal"><div class="slides" id="slides-container">${slidesHTML}</div></div>
<script src="https://cdn.jsdelivr.net/npm/reveal.js@4.5.0/dist/reveal.js"></script>
<script>
Reveal.initialize({width:800,height:600,margin:.05,minScale:.2,maxScale:1.5,hash:false,transition:'slide',controls:true,progress:true,center:true});
window.addSlide=(t,c)=>{const s=document.createElement('section');s.innerHTML='<h2>'+t+'</h2><div class="slide-content">'+c+'</div>';document.getElementById('slides-container').appendChild(s);Reveal.sync();Reveal.slide(Reveal.getTotalSlides()-1)};
window.goToSlide=i=>Reveal.slide(i);
window.updateTheme=n=>document.getElementById('theme-link').href='https://cdn.jsdelivr.net/npm/reveal.js@4.5.0/dist/theme/'+n;
</script></body></html>`;
}

// Download presentation as HTML file
export function downloadPresentationHTML(slides, initialTitle, initialContent, themeFile) {
  const html = createPresentationHTML(slides, initialTitle, initialContent, themeFile);
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `live-slides-${new Date().toISOString().split('T')[0]}.html`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
