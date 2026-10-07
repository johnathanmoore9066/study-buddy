"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { CosmosEngine, type CosmosPick } from "@/components/universe-engine";
import type { Cosmos } from "@/lib/cosmos";
import type { ConceptEdge, ConceptNode } from "@/lib/types";

interface SkillUniverseProps {
  nodes: ConceptNode[];
  edges: ConceptEdge[];
  cosmos: Cosmos;
  selection: CosmosPick | null;
  onSelect: (pick: CosmosPick) => void;
}

export function SkillUniverse({
  nodes,
  edges,
  cosmos,
  selection,
  onSelect,
}: SkillUniverseProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<CosmosEngine | null>(null);
  const onSelectRef = useRef(onSelect);
  const [unsupported, setUnsupported] = useState(false);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    let engine: CosmosEngine;
    try {
      engine = new CosmosEngine(mount, (pick) => onSelectRef.current(pick));
    } catch {
      setUnsupported(true);
      return;
    }
    engineRef.current = engine;
    return () => {
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    engineRef.current?.setContent(cosmos, nodes, edges);
  }, [cosmos, edges, nodes]);

  useEffect(() => {
    engineRef.current?.setSelection(selection);
  }, [selection]);

  if (unsupported) {
    return (
      <div className="cosmos-fallback" role="status">
        <strong>This browser can’t draw the universe</strong>
        <p>
          WebGL is turned off or unavailable here. Your conversation and
          learning progress still work.
        </p>
      </div>
    );
  }

  return (
    <div className="cosmos">
      <div className="cosmos-mount" ref={mountRef} />
      {nodes.length > 0 && (
        <div className="cosmos-nav" role="group" aria-label="Camera" data-occludes>
          <button
            type="button"
            onClick={() => engineRef.current?.flyTo({ kind: "overview" })}
          >
            <Icon name="galaxy" size={15} />
            <span>All systems</span>
          </button>
          <button
            type="button"
            disabled={!selection}
            onClick={() => selection && engineRef.current?.flyTo(selection)}
          >
            <Icon name="crosshair" size={15} />
            <span>Re-center</span>
          </button>
        </div>
      )}
    </div>
  );
}
