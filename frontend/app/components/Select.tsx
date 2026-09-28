"use client";

import { Children, isValidElement, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";

interface OpcionSelect {
  value: string;
  label: string;
  disabled?: boolean;
}

interface SelectProps {
  value: string;
  onChange: (valor: string) => void;
  children: React.ReactNode;
  disabled?: boolean;
  className?: string;
  id?: string;
  "aria-label"?: string;
}

// Lee las <option> hijas tal cual las usaría un <select> nativo, para que
// reemplazar `<select>` por `<Select>` no obligue a reescribir las listas de
// opciones ya construidas con .map en cada formulario/filtro.
function opcionesDesdeHijos(children: React.ReactNode): OpcionSelect[] {
  return Children.toArray(children)
    .filter(isValidElement<{ value?: string; disabled?: boolean; children?: React.ReactNode }>)
    .map((hijo) => ({
      value: String(hijo.props.value ?? ""),
      label: typeof hijo.props.children === "string" ? hijo.props.children : String(hijo.props.children ?? ""),
      disabled: hijo.props.disabled,
    }));
}

// Quita acentos y normaliza mayúsculas para que buscar "jose" encuentre "José".
function normalizar(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export function Select({ value, onChange, children, disabled, className, id, ...resto }: SelectProps) {
  const opciones = useMemo(() => opcionesDesdeHijos(children), [children]);
  const [abierto, setAbierto] = useState(false);
  const [busqueda, setBusqueda] = useState("");
  const [resaltado, setResaltado] = useState(0);
  const [posicion, setPosicion] = useState<{ top: number; left: number; width: number } | null>(null);
  const disparadorRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const busquedaRef = useRef<HTMLInputElement>(null);

  const actual = opciones.find((opcion) => opcion.value === value);
  // Con más de unas pocas opciones vale la pena poder filtrar escribiendo;
  // con pocas, el buscador solo estorbaría.
  const conBuscador = opciones.length > 6;
  const opcionesFiltradas = useMemo(() => {
    if (!conBuscador || !busqueda.trim()) return opciones;
    const buscado = normalizar(busqueda);
    return opciones.filter((opcion) => normalizar(opcion.label).includes(buscado));
  }, [opciones, busqueda, conBuscador]);

  const abrir = () => {
    if (disabled || opciones.length === 0) return;
    const rect = disparadorRef.current?.getBoundingClientRect();
    if (rect) setPosicion({ top: rect.bottom + 4, left: rect.left, width: rect.width });
    setBusqueda("");
    const indiceActual = opciones.findIndex((opcion) => opcion.value === value);
    setResaltado(indiceActual >= 0 ? indiceActual : 0);
    setAbierto(true);
  };
  const cerrar = () => setAbierto(false);
  const elegir = (opcion: OpcionSelect) => {
    if (opcion.disabled) return;
    onChange(opcion.value);
    cerrar();
  };

  useEffect(() => {
    if (!abierto) return;
    if (conBuscador) busquedaRef.current?.focus();
  }, [abierto, conBuscador]);

  useEffect(() => {
    if (!abierto) return;
    const alHacerClicFuera = (evento: MouseEvent) => {
      const objetivo = evento.target as Node;
      if (disparadorRef.current?.contains(objetivo) || panelRef.current?.contains(objetivo)) return;
      cerrar();
    };
    const alPresionarTecla = (evento: KeyboardEvent) => {
      if (evento.key === "Escape") { evento.stopPropagation(); cerrar(); disparadorRef.current?.focus(); }
      else if (evento.key === "ArrowDown") { evento.preventDefault(); setResaltado((actual) => Math.min(opcionesFiltradas.length - 1, actual + 1)); }
      else if (evento.key === "ArrowUp") { evento.preventDefault(); setResaltado((actual) => Math.max(0, actual - 1)); }
      else if (evento.key === "Enter") { evento.preventDefault(); const opcion = opcionesFiltradas[resaltado]; if (opcion) elegir(opcion); }
      else if (evento.key === " " && evento.target !== busquedaRef.current) { evento.preventDefault(); const opcion = opcionesFiltradas[resaltado]; if (opcion) elegir(opcion); }
    };
    // El scroll dentro del propio panel (p. ej. la lista de opciones larga)
    // no debe cerrar el menú: solo el scroll de un contenedor ancestro (un
    // modal con overflow-y) invalida la posición calculada y amerita cerrarlo.
    const alDesplazar = (evento: Event) => {
      if (evento.target instanceof Node && panelRef.current?.contains(evento.target)) return;
      cerrar();
    };
    document.addEventListener("mousedown", alHacerClicFuera);
    document.addEventListener("keydown", alPresionarTecla, true);
    window.addEventListener("scroll", alDesplazar, true);
    window.addEventListener("resize", alDesplazar);
    return () => {
      document.removeEventListener("mousedown", alHacerClicFuera);
      document.removeEventListener("keydown", alPresionarTecla, true);
      window.removeEventListener("scroll", alDesplazar, true);
      window.removeEventListener("resize", alDesplazar);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierto, opcionesFiltradas, resaltado]);

  return (
    <>
      <button
        ref={disparadorRef}
        type="button"
        className={`select-trigger ${className ?? ""}`}
        disabled={disabled}
        onClick={() => (abierto ? cerrar() : abrir())}
        aria-haspopup="listbox"
        aria-expanded={abierto}
        id={id}
        {...resto}
      >
        <span>{actual?.label ?? ""}</span>
        <ChevronDown size={14} className={`select-caret ${abierto ? "open" : ""}`} />
      </button>
      {abierto && posicion && createPortal(
        <div ref={panelRef} className="select-panel" style={{ top: posicion.top, left: posicion.left, width: posicion.width }}>
          {conBuscador && (
            <input
              ref={busquedaRef}
              type="text"
              className="select-search"
              placeholder="Buscar..."
              value={busqueda}
              onChange={(evento) => { setBusqueda(evento.target.value); setResaltado(0); }}
            />
          )}
          <ul className="select-menu" role="listbox">
            {opcionesFiltradas.length === 0 && <li className="select-sin-resultados">Sin resultados</li>}
            {opcionesFiltradas.map((opcion, indice) => (
              <li
                key={opcion.value}
                role="option"
                aria-selected={opcion.value === value}
                className={[opcion.value === value && "selected", indice === resaltado && "highlighted", opcion.disabled && "disabled"].filter(Boolean).join(" ")}
                onMouseEnter={() => setResaltado(indice)}
                onClick={() => elegir(opcion)}
              >
                <span>{opcion.label}</span>
                {opcion.value === value && <Check size={14} />}
              </li>
            ))}
          </ul>
        </div>,
        document.body,
      )}
    </>
  );
}
