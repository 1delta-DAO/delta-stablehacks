/**
 * Themed select dropdown — wraps native <select> with forced background colors
 * to work around DaisyUI 5's transparent select issue.
 */

interface DropdownOption {
  value: string | number;
  label: string;
}

interface DropdownProps {
  options: DropdownOption[];
  value: string | number;
  onChange: (value: string | number) => void;
  className?: string;
}

export default function Dropdown({ options, value, onChange, className = "" }: DropdownProps) {
  return (
    <div className={`relative ${className}`}>
      <select
        value={value}
        onChange={(e) => {
          const opt = options.find((o) => String(o.value) === e.target.value);
          if (opt) onChange(opt.value);
        }}
        className="w-full h-10 px-3 pr-8 rounded-lg border border-base-300 font-normal text-sm appearance-none cursor-pointer"
        style={{
          backgroundColor: "var(--fallback-b2, oklch(var(--b2)))",
          color: "var(--fallback-bc, oklch(var(--bc)))",
        }}
      >
        {options.map((o) => (
          <option
            key={o.value}
            value={o.value}
            style={{
              backgroundColor: "var(--fallback-b2, oklch(var(--b2)))",
              color: "var(--fallback-bc, oklch(var(--bc)))",
            }}
          >
            {o.label}
          </option>
        ))}
      </select>
      {/* Custom chevron */}
      <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2 opacity-50">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </div>
    </div>
  );
}
