'use client';

export default function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className="text-xs border border-slate-700 hover:border-slate-500 text-slate-400 hover:text-white px-3 py-1.5 rounded-lg transition-colors"
    >
      Print
    </button>
  );
}
