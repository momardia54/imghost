import { SearchIcon, XIcon } from "../icons";

export default function SearchBox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="search-box">
      <SearchIcon />
      <input
        type="text"
        placeholder="Search folders and images"
        aria-label="Search folders and images"
        value={value}
        maxLength={100}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onChange("");
        }}
      />
      {value && (
        <button className="icon-btn" title="Clear search" aria-label="Clear search" onClick={() => onChange("")}>
          <XIcon />
        </button>
      )}
    </div>
  );
}
