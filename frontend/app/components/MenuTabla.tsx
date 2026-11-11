"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Check } from "lucide-react";

export interface OpcionMenuTabla {
  id: string;
  etiqueta: string;
  descripcion?: string;
  icono?: ReactNode;
  // En menús de selección (p. ej. filtros) marca la opción vigente.
  seleccionada?: boolean;
  deshabilitada?: boolean;
  onSelect: () => void;
}

interface MenuTablaProps {
  icono: ReactNode;
  // Nombre accesible y tooltip del botón.
  etiqueta: string;
  titulo: string;
  opciones: OpcionMenuTabla[];
  // Punto indicador sobre el botón (p. ej. filtro aplicado).
  activo?: boolean;
  deshabilitado?: boolean;
}

// Botón de herramienta de tabla con menú desplegable (inspirado en el kit
// «Data Table Components»): título, separador y opciones de 40 px. Cierra con
// Escape, clic fuera o al elegir; flechas arriba/abajo recorren las opciones.
export function MenuTabla({ icono, etiqueta, titulo, opciones, activo = false, deshabilitado = false }: MenuTablaProps) {
  const [abierto, setAbierto] = useState(false);
  const contenedor = useRef<HTMLDivElement>(null);
  const boton = useRef<HTMLButtonElement>(null);
  const idMenu = useId();

  useEffect(() => {
    if (!abierto) return;
    const alPulsarFuera = (evento: MouseEvent) => {
      if (!contenedor.current?.contains(evento.target as Node)) setAbierto(false);
    };
    document.addEventListener("mousedown", alPulsarFuera);
    contenedor.current?.querySelector<HTMLButtonElement>('[role^="menuitem"]:not(:disabled)')?.focus();
    return () => document.removeEventListener("mousedown", alPulsarFuera);
  }, [abierto]);

  const alTeclear = (evento: React.KeyboardEvent<HTMLElement>) => {
    if (evento.key === "Escape") {
      evento.preventDefault();
      setAbierto(false);
      boton.current?.focus();
      return;
    }
    if (evento.key !== "ArrowDown" && evento.key !== "ArrowUp") return;
    evento.preventDefault();
    const elementos = [...(contenedor.current?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]:not(:disabled)') ?? [])];
    const actual = elementos.indexOf(document.activeElement as HTMLButtonElement);
    const siguiente = evento.key === "ArrowDown" ? (actual + 1) % elementos.length : (actual - 1 + elementos.length) % elementos.length;
    elementos[siguiente]?.focus();
  };

  const esSeleccion = opciones.some((opcion) => opcion.seleccionada !== undefined);

  return (
    <div className="table-menu-anchor" ref={contenedor}>
      <button
        ref={boton}
        type="button"
        className={`table-tool${abierto ? " open" : ""}`}
        aria-label={etiqueta}
        title={etiqueta}
        aria-haspopup="menu"
        aria-expanded={abierto}
        aria-controls={abierto ? idMenu : undefined}
        disabled={deshabilitado}
        onClick={() => setAbierto((valor) => !valor)}
        onKeyDown={(evento) => { if (abierto) alTeclear(evento); }}
      >
        {icono}
        {activo && <span className="table-tool-dot" aria-hidden="true" />}
      </button>
      {abierto && (
        <div className="table-menu" id={idMenu} role="menu" aria-label={titulo} tabIndex={-1} onKeyDown={alTeclear}>
          <strong className="table-menu-title">{titulo}</strong>
          {opciones.map((opcion) => (
            <button
              key={opcion.id}
              type="button"
              role={esSeleccion ? "menuitemradio" : "menuitem"}
              aria-checked={esSeleccion ? Boolean(opcion.seleccionada) : undefined}
              className={`table-menu-item${opcion.seleccionada ? " selected" : ""}`}
              disabled={opcion.deshabilitada}
              onClick={() => {
                setAbierto(false);
                boton.current?.focus();
                opcion.onSelect();
              }}
            >
              {opcion.icono && <span className="table-menu-icon" aria-hidden="true">{opcion.icono}</span>}
              <span className="table-menu-text">
                <span>{opcion.etiqueta}</span>
                {opcion.descripcion && <small>{opcion.descripcion}</small>}
              </span>
              {opcion.seleccionada && <Check size={16} className="table-menu-check" aria-hidden="true" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
