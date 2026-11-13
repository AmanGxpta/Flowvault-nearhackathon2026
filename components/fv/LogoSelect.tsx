"use client";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Check, ChevronDown } from "lucide-react";

export interface LogoOption { value: string; label: string; icon: ReactNode; disabled?: boolean; }
/** Image-capable select with listbox semantics and keyboard selection. */
export function LogoSelect({ label, value, options, onChange, disabled = false }: { label: string; value: string; options: LogoOption[]; onChange: (value: string) => void; disabled?: boolean }) {
  const id = useId(), root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const selected = options.find(x => x.value === value);
  const selectedIndex = Math.max(0, options.findIndex(x => x.value === value));
  const [focused, setFocused] = useState(selectedIndex);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  useEffect(() => { if (open) root.current?.querySelector<HTMLButtonElement>('[data-option-index="' + focused + '"]')?.focus(); }, [open, focused]);
  function choose(option: LogoOption) { if (option.disabled) return; onChange(option.value); setOpen(false); trigger.current?.focus(); }
  function key(event: KeyboardEvent) {
    if (event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus(); return; }
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const direction = event.key === "ArrowUp" ? -1 : 1;
      let next = !open ? selectedIndex : event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : (focused + direction + options.length) % options.length;
      for (let i = 0; i < options.length && options[next]?.disabled; i++) next = (next + direction + options.length) % options.length;
      setFocused(next); setOpen(true);
    }
  }
  return <div ref={root} className="fv-logo-select" onKeyDown={key} onBlur={event => { if (!root.current?.contains(event.relatedTarget as Node)) setOpen(false); }}>
    <button ref={trigger} type="button" aria-label={label + ": " + (selected?.label ?? value)} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? id : undefined} disabled={disabled} className="fv-logo-select-trigger" onClick={() => { setFocused(selectedIndex); setOpen(!open); }}>
      <span className="fv-logo-select-value">{selected?.icon}<span>{selected?.label ?? value}</span></span><ChevronDown size={16} aria-hidden />
    </button>
    {open && <div id={id} role="listbox" aria-label={label} className="fv-logo-select-menu">{options.map((option, index) => <button key={option.value} type="button" role="option" tabIndex={-1} data-option-index={index} aria-selected={option.value === value} aria-disabled={option.disabled || undefined} onClick={() => choose(option)} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); choose(option); } }}><span className="fv-logo-select-value">{option.icon}<span>{option.label}</span></span>{option.value === value && <Check size={16} aria-hidden />}</button>)}</div>}
  </div>;
}
