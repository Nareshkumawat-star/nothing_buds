"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { RevealText } from "@/components/ui/reveal-text";

export default function RevealTextDemo() {
  const [container, setContainer] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const target = document.getElementById("reveal-footer-root");
    if (target) {
      setContainer(target);
    }
  }, []);

  const content = (
    <footer className="w-full py-20 bg-[#0a0a0b] flex flex-col items-center justify-center text-white border-t border-[#1f1f23] overflow-hidden">
      <div className="mb-4 text-xs uppercase tracking-[0.3em] text-[#c4793c] font-mono">
        CMF BUDS BY NOTHING
      </div>
      <RevealText 
        text="NOTHING"
        textColor="text-white"
        overlayColor="text-[#c4793c]"
        fontSize="text-[80px] sm:text-[120px] md:text-[160px]"
        letterDelay={0.08}
        overlayDelay={0.05}
        overlayDuration={0.4}
        springDuration={600}
      />
      <p className="mt-8 text-[#9aa1a9] text-xs sm:text-sm uppercase tracking-[0.2em] font-mono text-center px-4">
        Hover over the typography to reveal CMF Buds internal architecture
      </p>
    </footer>
  );

  if (!container) {
    return null;
  }

  return createPortal(content, container);
}
