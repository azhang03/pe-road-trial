// The question card and the Field Book drawer.
// The card adds card.css to the page by itself.

import { parseAnswer, checkAnswer, formatValue } from './questions.js';
import { FIELD_BOOK } from './fieldbook.js';

const KIND_LABEL = { quick: 'Quick', step: 'One step', full: 'Full' };
const TOPIC_LABEL = { horizontal: 'Horizontal design', vertical: 'Vertical design' };
const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

function ensureStyle() {
  const href = new URL('./card.css', import.meta.url).href;
  for (const link of document.querySelectorAll('link[rel="stylesheet"]')) {
    if (link.href === href) return;
  }
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  document.head.append(link);
}

/** Make an element. Text goes in as text, never as HTML. */
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(className, text) {
  const b = el('button', className, text);
  b.type = 'button';
  return b;
}

/** Whole seconds as mm:ss. */
function clock(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

const round2 = (x) => Math.round(x * 100) / 100;

/** The text of the right answer. */
function rightText(question) {
  if (question.answer !== null && question.answer !== undefined) {
    return formatValue(question, question.answer);
  }
  const right = question.choices.find((c) => c.correct);
  return right ? right.text : '';
}

/**
 * Ask one question in host.
 * The card is added to host and removed again when the promise resolves.
 * Resolves with { correct, skipped, value, elapsed, over, usedSecondOpinion }.
 * elapsed and over are in seconds.
 * opts.onAnswer(result), if given, runs after the check and before the solution shows.
 * The card is hidden and its timer is stopped while the card waits for it.
 */
export function askQuestion(host, question, opts = {}) {
  ensureStyle();
  const {
    timeLimit = null,
    reveal = false,
    secondOpinion = false,
    bookmark = 0,
    canSkip = false,
    onAnswer = null,
  } = opts;
  // A concept question, or one with no typed answer, is always a choice question.
  const format =
    opts.format === 'number' && question.numeric !== false && question.answer !== null
      ? 'number'
      : 'choice';

  return new Promise((resolve) => {
    const card = el('section', 'pe-card');
    card.setAttribute('aria-label', question.title);

    // Head: title, kind badge, timer.
    const head = el('header', 'pe-card-head');
    const title = el('h2', 'pe-card-title', question.title);
    const badge = el('span', `pe-badge pe-badge-${question.kind}`, KIND_LABEL[question.kind] ?? question.kind);
    const timer = el('span', 'pe-timer');
    timer.setAttribute('role', 'timer');
    if (timeLimit === null) timer.hidden = true;
    head.append(title, badge, timer);

    // The prompt keeps its line breaks through CSS (white-space: pre-line).
    const prompt = el('p', 'pe-prompt', question.prompt);

    const parts = [head, prompt];

    if (bookmark >= 2 && question.solution && question.solution.length > 0) {
      const hint = el('div', 'pe-hint');
      hint.append(el('span', 'pe-hint-label', 'First step'), el('span', 'pe-hint-text', question.solution[0]));
      parts.push(hint);
    }

    const answerArea = el('div', 'pe-answer');
    parts.push(answerArea);

    const tools = el('div', 'pe-tools');
    const bookBtn = button('pe-btn pe-btn-quiet pe-book-btn', 'Field Book');
    if (bookmark >= 1) {
      bookBtn.classList.add('pe-marked');
      const entry = FIELD_BOOK.find((e) => e.id === question.fieldBook);
      bookBtn.textContent = entry ? `Field Book: ${entry.title}` : 'Field Book';
    }
    bookBtn.addEventListener('click', () => openFieldBook(bookmark >= 1 ? question.fieldBook : undefined));
    tools.append(bookBtn);
    // Second Opinion: a tap hides 2 wrong options. Choice format only.
    let opinionBtn = null;
    let usedSecondOpinion = false;
    if (secondOpinion && format === 'choice') {
      opinionBtn = button('pe-btn pe-btn-quiet pe-opinion-btn', 'Second Opinion');
      tools.append(opinionBtn);
    }
    let skipBtn = null;
    if (canSkip) {
      skipBtn = button('pe-btn pe-btn-quiet pe-skip-btn', 'Skip');
      tools.append(skipBtn);
    }
    parts.push(tools);

    const result = el('div', 'pe-result');
    result.hidden = true;
    parts.push(result);

    card.append(...parts);
    host.append(card);

    // Timer.
    const start = performance.now();
    const seconds = () => (performance.now() - start) / 1000;
    let tickId = 0;
    function tick() {
      if (!card.isConnected) {
        clearInterval(tickId);
        return;
      }
      if (timeLimit === null) return;
      const t = seconds();
      if (t < timeLimit) {
        timer.textContent = clock(Math.ceil(timeLimit - t));
        timer.classList.remove('pe-over');
      } else {
        timer.textContent = `+${clock(t - timeLimit)}`;
        timer.classList.add('pe-over');
      }
    }
    tick();
    tickId = setInterval(tick, 200);

    let done = false;
    function stopClock() {
      const t = seconds();
      clearInterval(tickId);
      tick();
      return {
        elapsed: round2(t),
        over: timeLimit === null ? 0 : round2(Math.max(0, t - timeLimit)),
      };
    }

    function finish(out) {
      card.remove();
      resolve(out);
    }

    /** Hide the card while the onAnswer hook runs. A failed hook does not stop the card. */
    async function runHook(out) {
      if (!onAnswer) return;
      card.hidden = true;
      try {
        await onAnswer(out);
      } catch (err) {
        console.error(err);
      }
      card.hidden = false;
    }

    if (skipBtn) {
      skipBtn.addEventListener('click', async () => {
        if (done) return;
        done = true;
        const { elapsed, over } = stopClock();
        const out = { correct: false, skipped: true, value: null, elapsed, over, usedSecondOpinion };
        await runHook(out);
        finish(out);
      });
    }

    async function showResult(correct, value, chosen) {
      done = true;
      const { elapsed, over } = stopClock();
      const out = { correct, skipped: false, value, elapsed, over, usedSecondOpinion };
      await runHook(out);
      card.classList.add(correct ? 'pe-is-right' : 'pe-is-wrong');
      if (skipBtn) skipBtn.hidden = true;
      if (opinionBtn) opinionBtn.remove();

      result.replaceChildren();
      result.append(el('p', `pe-verdict ${correct ? 'pe-right' : 'pe-wrong'}`, correct ? 'Right' : 'Wrong'));
      const answerLine = el('p', 'pe-right-answer');
      answerLine.append(el('span', 'pe-label', 'Answer: '), el('strong', '', rightText(question)));
      result.append(answerLine);
      if (!correct && format === 'number' && value !== null) {
        const yours = el('p', 'pe-yours');
        yours.append(el('span', 'pe-label', 'You typed: '), el('span', '', formatValue(question, value)));
        result.append(yours);
      }
      if (!correct && chosen && chosen.why) {
        result.append(el('p', 'pe-why', chosen.why));
      }
      if (question.solution && question.solution.length > 0) {
        result.append(el('h3', 'pe-steps-head', 'Solution'));
        const ol = el('ol', 'pe-steps');
        for (const step of question.solution) ol.append(el('li', '', step));
        result.append(ol);
      }
      const cont = button('pe-btn pe-btn-main pe-continue', 'Continue');
      cont.addEventListener('click', () => finish(out));
      result.append(cont);
      result.hidden = false;
      cont.focus({ preventScroll: true });
      result.scrollIntoView({ block: 'nearest' });
    }

    if (format === 'choice') {
      const list = el('div', 'pe-options');
      list.setAttribute('role', 'group');
      list.setAttribute('aria-label', 'Options');
      const buttons = [];
      for (const choice of question.choices) {
        const b = button('pe-option');
        b.append(el('span', 'pe-option-letter', LETTERS[buttons.length] ?? String(buttons.length + 1)), el('span', 'pe-option-text', choice.text));
        if (reveal && choice.correct) b.classList.add('pe-reveal');
        b.addEventListener('click', () => {
          if (done) return;
          for (const other of buttons) other.disabled = true;
          b.classList.add('pe-chosen', choice.correct ? 'pe-right' : 'pe-wrong');
          for (const other of buttons) {
            if (other.dataset.correct === '1') other.classList.add('pe-is-answer');
          }
          showResult(choice.correct, choice.value ?? null, choice);
        });
        b.dataset.correct = choice.correct ? '1' : '0';
        buttons.push(b);
        list.append(b);
      }
      answerArea.append(list);
      if (opinionBtn) {
        opinionBtn.addEventListener('click', () => {
          if (done) return;
          // Hide the first 2 wrong options in the shuffled order, so a seed gives the same result.
          let left = 2;
          for (const b of buttons) {
            if (left > 0 && b.dataset.correct === '0') {
              b.hidden = true;
              left -= 1;
            }
          }
          // Letter the options that stay A, B, ...
          buttons.filter((b) => !b.hidden).forEach((b, n) => {
            b.querySelector('.pe-option-letter').textContent = LETTERS[n] ?? String(n + 1);
          });
          usedSecondOpinion = true;
          opinionBtn.remove();
          buttons.find((b) => !b.hidden)?.focus({ preventScroll: true });
        });
      }
    } else {
      const form = el('form', 'pe-number');
      form.noValidate = true;
      const label = el('label', 'pe-number-label');
      const input = el('input', 'pe-input');
      input.type = 'text';
      input.inputMode = 'decimal';
      input.autocomplete = 'off';
      input.spellcheck = false;
      input.setAttribute('autocapitalize', 'off');
      input.setAttribute('enterkeyhint', 'done');
      input.setAttribute('aria-label', question.answerType === 'station' ? 'Answer (station, for example 98+40.51)' : 'Answer');
      input.placeholder = question.answerType === 'station' ? '98+40.51' : 'Your answer';
      label.append(input);
      if (question.unit) label.append(el('span', 'pe-unit', question.unit));
      const submit = el('button', 'pe-btn pe-btn-main pe-submit', 'Submit');
      submit.type = 'submit';
      const row = el('div', 'pe-number-row');
      row.append(label, submit);
      const msg = el('p', 'pe-msg');
      msg.setAttribute('role', 'alert');
      msg.hidden = true;
      form.append(row, msg);
      if (reveal) {
        form.append(el('p', 'pe-reveal-value', `Right value: ${formatValue(question, question.answer)}`));
      }
      input.addEventListener('input', () => {
        msg.hidden = true;
        input.removeAttribute('aria-invalid');
      });
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        if (done) return;
        const value = parseAnswer(question, input.value);
        if (value === null) {
          msg.textContent =
            question.answerType === 'station'
              ? 'Type a number or a station, for example 602.2 or 98+40.51.'
              : 'Type a number, for example 602.2.';
          msg.hidden = false;
          input.setAttribute('aria-invalid', 'true');
          input.focus();
          return;
        }
        const correct = checkAnswer(question, value);
        input.disabled = true;
        submit.disabled = true;
        form.classList.add(correct ? 'pe-right' : 'pe-wrong');
        showResult(correct, value, null);
      });
      answerArea.append(form);
      // Do not open the phone keyboard by itself. Desktop gets the focus.
      if (matchMedia('(pointer: fine)').matches) input.focus({ preventScroll: true });
    }
  });
}

// ---- Field Book drawer ----

let drawer = null;

function topicLabel(topic) {
  if (TOPIC_LABEL[topic]) return TOPIC_LABEL[topic];
  const t = String(topic ?? 'Other');
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function buildDrawer() {
  const backdrop = el('div', 'pe-fb-backdrop');
  const panel = el('aside', 'pe-fb');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', 'Field Book');
  panel.tabIndex = -1;

  const head = el('header', 'pe-fb-head');
  const indexBtn = button('pe-btn pe-btn-quiet pe-fb-index-btn', '‹ Index');
  const heading = el('h2', 'pe-fb-title', 'Field Book');
  const close = button('pe-btn pe-btn-quiet pe-fb-close', '×');
  close.setAttribute('aria-label', 'Close the Field Book');
  head.append(indexBtn, heading, close);

  const cols = el('div', 'pe-fb-cols');
  const nav = el('nav', 'pe-fb-index');
  nav.setAttribute('aria-label', 'Field Book index');
  const groups = new Map();
  for (const entry of FIELD_BOOK) {
    if (!groups.has(entry.topic)) groups.set(entry.topic, []);
    groups.get(entry.topic).push(entry);
  }
  const links = new Map();
  for (const [topic, entries] of groups) {
    nav.append(el('h3', 'pe-fb-topic', topicLabel(topic)));
    const ul = el('ul', 'pe-fb-list');
    for (const entry of entries) {
      const li = el('li');
      const b = button('pe-fb-link', entry.title);
      b.addEventListener('click', () => show(entry.id));
      links.set(entry.id, b);
      li.append(b);
      ul.append(li);
    }
    nav.append(ul);
  }

  const view = el('article', 'pe-fb-entry');
  cols.append(nav, view);
  panel.append(head, cols);

  let lastFocus = null;

  function show(entryId) {
    const entry = FIELD_BOOK.find((e) => e.id === entryId);
    for (const [id, b] of links) b.classList.toggle('pe-current', entry !== undefined && id === entry.id);
    view.replaceChildren();
    if (!entry) {
      panel.classList.remove('pe-fb-has-entry');
      view.append(el('p', 'pe-fb-empty', 'Pick an entry from the index.'));
      nav.scrollTop = 0;
      return;
    }
    panel.classList.add('pe-fb-has-entry');
    view.append(el('h3', 'pe-fb-entry-title', entry.title));
    const body = el('div', 'pe-fb-body');
    body.innerHTML = entry.body; // Trusted HTML from fieldbook.js.
    view.append(body);
    if (entry.cite) view.append(el('p', 'pe-fb-cite', entry.cite));
    view.scrollTop = 0;
  }

  function onKey(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      hide();
    }
  }

  function open(entryId) {
    if (!panel.isConnected) {
      lastFocus = document.activeElement;
      document.body.append(backdrop, panel);
      document.addEventListener('keydown', onKey, true);
      // Let the browser lay out the closed state first, so the slide runs.
      void panel.offsetWidth;
      backdrop.classList.add('pe-open');
      panel.classList.add('pe-open');
    }
    show(entryId);
    close.focus({ preventScroll: true });
  }

  function hide() {
    if (!panel.isConnected) return;
    document.removeEventListener('keydown', onKey, true);
    backdrop.remove();
    panel.remove();
    backdrop.classList.remove('pe-open');
    panel.classList.remove('pe-open');
    if (lastFocus && lastFocus.isConnected) lastFocus.focus({ preventScroll: true });
    lastFocus = null;
  }

  close.addEventListener('click', hide);
  backdrop.addEventListener('click', hide);
  indexBtn.addEventListener('click', () => show(undefined));

  return { open, hide };
}

/** Open the drawer at the entry, or at the index when entryId is missing or unknown. */
export function openFieldBook(entryId) {
  ensureStyle();
  if (!drawer) drawer = buildDrawer();
  drawer.open(entryId);
}
