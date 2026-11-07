// The HUD: budget, fee, stage, segments, the flaw list, and the owned items.
// The item chips copy the M1 HUD (../map/main.js, renderHud) so both prototypes read the same.

import { ITEM_IDS, ITEM_NAME, ITEM_SHORT, USE_ITEMS, itemEffect } from './items.js';

/** Make an element. Strings become text, never HTML. */
export function el(tag, className, ...children) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  for (const c of children) node.append(c);
  return node;
}

export function button(className, text, onClick) {
  const b = el('button', className, text);
  b.type = 'button';
  if (onClick) b.addEventListener('click', onClick);
  return b;
}

/** 1000 gives "$1,000k". A minus sign goes in front of a value below 0. */
export function money(k) {
  return `${k < 0 ? '\u2212' : ''}$${Math.abs(Math.round(k)).toLocaleString('en-US')}k`;
}

function chip(label, value, className = '') {
  return el('div', `chip ${className}`, el('span', 'label', label), el('strong', '', value));
}

/**
 * Draw the HUD.
 * view: { run, rules, open (the open item id, 'flaws', or null), copies(id), usesLeft(id), flaws (pieces),
 *   onToggle(key), onFlaw(piece) }.
 */
export function renderHud(host, view) {
  const { run, rules, open } = view;
  const share = Math.max(0, Math.min(1, run.budget / rules.startBudget));
  const budget = chip('Budget', money(run.budget), 'budget');
  budget.id = 'budget-box';
  const bar = el('span', 'bar');
  const fill = el('span', share < 0.3 ? 'low' : '');
  fill.style.width = `${share * 100}%`;
  bar.append(fill);
  budget.append(bar);
  const fee = chip('Fee', money(run.fee));
  fee.id = 'fee-box';
  const row = el('div', 'hud-row', budget, fee, chip('Stage', String(run.stage)), chip('Segment', `${run.built} / ${rules.stageLength}`));

  const flaws = view.flaws;
  const flawBtn = button(`chip flaw-chip${flaws.length ? ' has-flaws' : ''}${open === 'flaws' ? ' is-open' : ''}`, '', () => view.onToggle('flaws'));
  flawBtn.append(el('span', 'label', 'Flaws'), el('strong', '', String(flaws.length)));
  flawBtn.setAttribute('aria-expanded', open === 'flaws' ? 'true' : 'false');
  row.append(flawBtn);
  const parts = [row];

  const owned = ITEM_IDS.filter((id) => view.copies(id) > 0);
  if (owned.length > 0) {
    const list = el('div', 'hud-items');
    list.setAttribute('aria-label', 'Items');
    for (const id of owned) {
      let text = `${ITEM_SHORT[id]} \u00d7${view.copies(id)}`;
      if (USE_ITEMS.includes(id)) text += `, ${view.usesLeft(id)} left`;
      const spent = USE_ITEMS.includes(id) && view.usesLeft(id) <= 0;
      const c = button(`hud-item item-${id}${open === id ? ' is-open' : ''}${spent ? ' is-spent' : ''}`, text, () => view.onToggle(id));
      c.setAttribute('aria-expanded', open === id ? 'true' : 'false');
      list.append(c);
    }
    parts.push(list);
  }

  if (open === 'flaws') {
    const box = el('div', 'hud-info hud-flaws');
    if (!flaws.length) box.append('No flaws in the road.');
    else {
      box.append(el('p', 'hud-flaw-head', 'Flaws in the road. Each one left costs a claim on opening day. Tap one to see it.'));
      for (const p of flaws) {
        const b = button('hud-flaw', '', () => view.onFlaw(p));
        b.append(el('strong', '', p.stepName), ` ${p.flawName}`, p.claimed ? el('span', 'hud-flaw-paid', ' (claim paid)') : '');
        box.append(b);
      }
    }
    parts.push(box);
  } else if (open && view.copies(open) > 0) {
    const info = el('div', 'hud-info');
    info.setAttribute('role', 'note');
    info.append(el('strong', '', `${ITEM_NAME[open]} \u00d7${view.copies(open)}. `), itemEffect(open, view.copies(open), rules));
    if (USE_ITEMS.includes(open)) info.append(` ${view.usesLeft(open)} left this stage.`);
    parts.push(info);
  }
  host.replaceChildren(el('div', 'hud-inner', ...parts));
}

/** A card for one item. bought: the player just bought it here, so show what it does now. From M1. */
export function itemCard(id, have, rules, actions, bought = false) {
  const card = el('div', `item-card item-${id}`);
  const n = bought ? have : have + 1;
  let line = have > 0 ? `You have ${have}. This makes ${have + 1}.` : 'You have none.';
  if (bought) line = `You have ${have}.`;
  card.append(el('h3', '', ITEM_NAME[id]), el('p', 'item-effect', itemEffect(id, n, rules)), el('p', 'small', line), actions);
  return card;
}
