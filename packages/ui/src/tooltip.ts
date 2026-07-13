/**
 * Tooltip controller (roadmap M42; doc 01 §3 "legible depth": "every number
 * inspectable via tooltips/ledgers; no hidden modifiers"). Native `title=`
 * is mouse-hover-only — no keyboard trigger, no styling, no `role`. This
 * replaces it everywhere with one delegated listener (`mouseover`/`mouseout`
 * AND `focusin`/`focusout`, so tab-focusing a button shows the same tooltip
 * a hover would) bound once on `document`, so panels that `replaceChildren()`
 * and rebuild their body on every store change (`panels.ts`'s own doc
 * comment) never need to re-wire anything — any element anywhere with a
 * `data-tooltip` attribute is covered for free, forever.
 */
export class TooltipController {
  private readonly el: HTMLElement;
  private current: Element | null = null;
  private showTimer = 0;

  constructor(private readonly delayMs = 350) {
    this.el = document.createElement('div');
    this.el.className = 'tooltip';
    this.el.setAttribute('role', 'tooltip');
    this.el.hidden = true;
    document.body.append(this.el);

    document.addEventListener('mouseover', (e) => this.handleEnter(e));
    document.addEventListener('mouseout', (e) => this.handleLeave(e));
    document.addEventListener('focusin', (e) => this.handleEnter(e));
    document.addEventListener('focusout', (e) => this.handleLeave(e));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.hide();
    });
    // Scrolling/resizing would leave a stale-positioned tooltip behind — REPOSITION, don't hide:
    // focusing a target inside a scrollable panel (`#panel-dock` etc.) makes the browser
    // auto-scroll it into view, firing a scroll event a few ms after `show()` — hiding here would
    // dismiss a keyboard-triggered tooltip almost as soon as it appeared.
    window.addEventListener('scroll', () => this.reposition(), true);
    window.addEventListener('resize', () => this.reposition());
  }

  private reposition(): void {
    // only if already visible — a scroll mid-delay must not skip the hover/focus delay entirely
    if (this.current !== null && !this.el.hidden) this.show(this.current);
  }

  private targetOf(e: Event): Element | null {
    return e.target instanceof Element ? e.target.closest('[data-tooltip]') : null;
  }

  private handleEnter(e: Event): void {
    const target = this.targetOf(e);
    if (target === null || target === this.current) return;
    this.current = target;
    window.clearTimeout(this.showTimer);
    this.showTimer = window.setTimeout(() => this.show(target), this.delayMs);
  }

  private handleLeave(e: Event): void {
    const target = this.targetOf(e);
    if (target === null || target !== this.current) return;
    window.clearTimeout(this.showTimer);
    this.current = null;
    this.hide();
  }

  private show(target: Element): void {
    const text = (target as HTMLElement).dataset['tooltip'];
    if (text === undefined || text.length === 0) return;
    this.el.textContent = text;
    this.el.hidden = false;
    const rect = target.getBoundingClientRect();
    const top = Math.min(rect.bottom + 6, window.innerHeight - this.el.offsetHeight - 8);
    const left = Math.max(4, Math.min(rect.left, window.innerWidth - this.el.offsetWidth - 8));
    this.el.style.top = `${top}px`;
    this.el.style.left = `${left}px`;
  }

  hide(): void {
    this.el.hidden = true;
    this.current = null;
  }
}
