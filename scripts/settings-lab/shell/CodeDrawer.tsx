import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Icon } from "@/components/Icon";
import { spring } from "@lab/tokens";
import { useLab } from "./prefs";

const SOURCES = import.meta.glob(["../variants/*.{tsx,css}", "../kit/*.{ts,tsx,css}", "../chat/**/*.{ts,tsx,css}"], { query: "?raw", import: "default" });

const pathOf = (key: string) => `scripts/settings-lab/${key.replace(/^\.\.\//, "")}`;

/** the variant's own source and the kit it builds on, read straight from disk */
export function CodeDrawer({ open, files, onClose }: { open: boolean; files: string[]; onClose: () => void }) {
  const { reduced } = useLab();
  const [file, setFile] = useState(files[0]!);
  const [text, setText] = useState("");
  useEffect(() => setFile(files[0]!), [files]);
  useEffect(() => {
    if (!open) return;
    const load = SOURCES[`../${file}`];
    if (!load) { setText(`missing: ${file}`); return; }
    let live = true;
    void (load() as Promise<string>).then((source) => live && setText(source));
    return () => { live = false; };
  }, [file, open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [open, onClose]);
  const lines = text.split("\n");
  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          key="code"
          className="lab-code"
          aria-label="Source"
          initial={reduced ? { opacity: 0 } : { x: "100%" }}
          animate={reduced ? { opacity: 1 } : { x: 0 }}
          exit={reduced ? { opacity: 0 } : { x: "100%", transition: { duration: 0.2, ease: [0.22, 1, 0.36, 1] } }}
          transition={reduced ? { duration: 0.15 } : spring.soft}
        >
          <header className="lab-code-head">
            <div className="lab-code-files" role="tablist" aria-label="files">
              {files.map((entry) => (
                <button key={entry} type="button" role="tab" aria-selected={entry === file} className="lab-code-file" onClick={() => setFile(entry)}>
                  {entry.split("/").at(-1)}
                </button>
              ))}
            </div>
            <button type="button" className="lab-btn lab-btn-icon" aria-label="Close code" onClick={onClose}><Icon name="close" size={14} /></button>
          </header>
          <p className="lab-code-path">{pathOf(`../${file}`)}</p>
          <pre className="lab-code-body"><code>
            {lines.map((line, index) => (
              <span key={index} className="lab-code-line"><span className="lab-code-n">{index + 1}</span>{line || " "}{"\n"}</span>
            ))}
          </code></pre>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
