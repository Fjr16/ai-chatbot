const form = document.getElementById('chat-form');
const input = document.getElementById('user-input');
const modelSelect = document.getElementById('model-select');
const chatBox = document.getElementById('chat-box');
const conversation = [];
let previousInteractionId = null;
const DEFAULT_CHAT_CONFIG = {
  temperature: 0.7,
  top_k: 40,
  top_p: 0.9,
};

form.addEventListener('submit', async function (e) {
  e.preventDefault();

  const userMessage = input.value.trim();
  if (!userMessage) return;

  conversation.push({ role: 'user', text: userMessage });
  appendMessage('user', userMessage);
  input.value = '';

  const thinkingMessage = appendMessage('bot', 'thinking...');

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        conversation,
        config: DEFAULT_CHAT_CONFIG,
        model: modelSelect.value,
        previous_interaction_id: previousInteractionId,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errorMessage = errorData?.error?.message || 'Ada masalah pada server, hubungi developer.';
      updateMessage(thinkingMessage, errorMessage);
      return;
    }

    const data = await response.json();
    const botMessage = data?.message || 'Ada masalah pada server, hubungi developer.';

    updateMessage(thinkingMessage, botMessage);
    conversation.push({ role: 'model', text: botMessage });

    if (data?.interactionId) {
      previousInteractionId = data.interactionId;
    }
  } catch (error) {
    console.error('Chat fetch error:', error);
    updateMessage(thinkingMessage, 'Ada masalah pada server, hubungi developer.');
  }
});

function appendMessage(sender, text) {
  const msg = document.createElement('div');
  msg.classList.add('message', sender);
  msg.innerHTML = formatMessageContent(text);
  chatBox.appendChild(msg);
  chatBox.scrollTop = chatBox.scrollHeight;
  return msg;
}

function updateMessage(element, text) {
  if (!element) return;
  element.innerHTML = formatMessageContent(text);
  chatBox.scrollTop = chatBox.scrollHeight;
}

function formatMessageContent(text) {
  const safeText = String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  const lines = safeText.split('\n');
  const formattedLines = [];

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();

    if (!trimmed) {
      formattedLines.push('<div class="spacer"></div>');
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      const headingText = headingMatch[2].replace(/^\d+\.\s*/, '');
      formattedLines.push(`<div class="section-label">${renderInlineMarkdown(headingText)}</div>`);
      continue;
    }

    if (/^[-*•]\s+/.test(trimmed)) {
      const content = renderInlineMarkdown(trimmed.replace(/^[-*•]\s+/, ''));
      formattedLines.push(`<div class="bullet-item">• ${content}</div>`);
      continue;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      const match = trimmed.match(/^(\d+)\.\s+(.*)$/);
      const number = match ? match[1] : '1';
      const content = renderInlineMarkdown(match ? match[2] : trimmed);
      formattedLines.push(`<div class="ordered-item"><span>${number}.</span> ${content}</div>`);
      continue;
    }

    formattedLines.push(`<div>${renderInlineMarkdown(trimmed)}</div>`);
  }

  return formattedLines.join('');
}

function renderInlineMarkdown(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/_(.+?)_/g, '<u>$1</u>');
}
