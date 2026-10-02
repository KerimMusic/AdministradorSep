/* ═══════════════════════════════════════════
   SELECTOR DE ESTADO
   ═══════════════════════════════════════════ */
.estado-select {
  padding: 6px 10px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--panel2);
  color: var(--text);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  outline: none;
  min-width: 170px;
  transition: border-color 0.15s;
}
.estado-select:hover {
  border-color: var(--accent);
}
.estado-select:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px rgba(0, 212, 126, 0.15);
}
.estado-select:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.estado-select option {
  background: var(--panel);
  color: var(--text);
  padding: 8px;
}
