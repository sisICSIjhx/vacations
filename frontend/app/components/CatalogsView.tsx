"use client";

import { useState } from "react";
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { BriefcaseBusiness, Building2, CalendarDays, Check, MapPinned, Pencil, Plus, Trash2, X } from "lucide-react";
import type { Catalogo, DatosVacaciones, DiaFestivo } from "../types";

type Tipo = "sedes" | "proyectos" | "categorias";

interface CatalogsViewProps {
  datos: DatosVacaciones;
  actualizando: boolean;
  onSave: (tipo: Tipo, entrada: { id?: string; nombre: string }) => Promise<boolean>;
  // Sin onDelete/onDeleteFestivo (p. ej. RRHH) la vista solo permite alta y edición.
  onDelete?: (tipo: Tipo, id: string) => Promise<boolean>;
  onSaveFestivo: (entrada: { id?: string; fecha: string; nombre: string }) => Promise<boolean>;
  onDeleteFestivo?: (id: string) => Promise<boolean>;
}

const configuracion: Array<{ tipo: Tipo; titulo: string; descripcion: string; icono: typeof MapPinned }> = [
  { tipo: "sedes", titulo: "Sedes", descripcion: "Ubicaciones y centros de trabajo", icono: MapPinned },
  { tipo: "proyectos", titulo: "Proyectos", descripcion: "Asignaciones operativas vigentes", icono: BriefcaseBusiness },
  { tipo: "categorias", titulo: "Categorías", descripcion: "Administrativo, dual y operativo", icono: Building2 },
];

function CatalogItem({ item, actualizando, onSave, onDelete }: { item: Catalogo; actualizando: boolean; onSave: (nombre: string) => Promise<boolean>; onDelete?: () => void }) {
  const [editando, setEditando] = useState(false);
  const [nombre, setNombre] = useState(item.nombre);

  const guardar = async () => {
    const limpio = nombre.trim();
    if (!limpio || limpio === item.nombre) {
      setNombre(item.nombre);
      setEditando(false);
      return;
    }
    if (await onSave(limpio)) setEditando(false);
  };
  const cancelar = () => {
    setNombre(item.nombre);
    setEditando(false);
  };

  if (editando) {
    return (
      <div className="catalog-edit-row">
        <input
          value={nombre}
          disabled={actualizando}
          onChange={(e) => setNombre(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void guardar();
            if (e.key === "Escape") cancelar();
          }}
        />
        <button className="icon-button subtle" type="button" onClick={guardar} disabled={actualizando} aria-label="Guardar cambio" title="Guardar cambio"><Check size={15} /></button>
        <button className="icon-button subtle" type="button" onClick={cancelar} disabled={actualizando} aria-label="Cancelar edición" title="Cancelar edición"><X size={15} /></button>
      </div>
    );
  }

  return (
    <div>
      <span className="catalog-dot" style={item.color ? { background: item.color } : undefined} />
      <strong>{item.nombre}</strong>
      <code>{item.codigo}</code>
      <div className="catalog-item-actions">
        <button className="icon-button subtle" type="button" onClick={() => setEditando(true)} disabled={actualizando} aria-label={`Editar ${item.nombre}`} title={`Editar ${item.nombre}`}><Pencil size={14} /></button>
        {onDelete && <button className="icon-button subtle danger" type="button" onClick={onDelete} disabled={actualizando} aria-label={`Eliminar ${item.nombre}`} title={`Eliminar ${item.nombre}`}><Trash2 size={14} /></button>}
      </div>
    </div>
  );
}

function CatalogCard({ tipo, titulo, descripcion, icono: Icono, items, actualizando, onSave, onDelete }: {
  tipo: Tipo;
  titulo: string;
  descripcion: string;
  icono: typeof MapPinned;
  items: Catalogo[];
  actualizando: boolean;
  onSave: (tipo: Tipo, entrada: { id?: string; nombre: string }) => Promise<boolean>;
  onDelete?: (tipo: Tipo, id: string) => Promise<boolean>;
}) {
  const [nuevo, setNuevo] = useState("");
  const agregar = () => {
    if (!nuevo.trim()) return;
    void onSave(tipo, { nombre: nuevo });
    setNuevo("");
  };
  const eliminar = (item: Catalogo) => {
    const singular = titulo.toLowerCase().replace(/s$/, "");
    if (window.confirm(`¿Eliminar "${item.nombre}"? El personal que tenga asignada esta ${singular} quedará sin ${singular}.`)) {
      void onDelete?.(tipo, item.id);
    }
  };
  return (
    <article className="catalog-card content-card">
      <header><span className="icon-tile blue"><Icono size={18} /></span><div><h2>{titulo}</h2><p>{descripcion}</p></div></header>
      <div className="catalog-list">
        {items.length === 0 && <p className="empty-note">Sin elementos todavía.</p>}
        {items.map((item) => (
          <CatalogItem
            key={item.id}
            item={item}
            actualizando={actualizando}
            onSave={(nombre) => onSave(tipo, { id: item.id, nombre })}
            onDelete={onDelete && (() => eliminar(item))}
          />
        ))}
      </div>
      <div className="catalog-add">
        <input value={nuevo} onChange={(e) => setNuevo(e.target.value)} onKeyDown={(e) => e.key === "Enter" && agregar()} placeholder={`Nueva ${titulo.toLowerCase().replace(/s$/, "")}`} disabled={actualizando} />
        <button className="icon-button" type="button" onClick={agregar} disabled={actualizando} aria-label={`Agregar ${titulo}`} title={`Agregar ${titulo}`}><Plus size={17} /></button>
      </div>
    </article>
  );
}

function FestivosCard({ items, actualizando, onSave, onDelete }: {
  items: DiaFestivo[];
  actualizando: boolean;
  onSave: (entrada: { id?: string; fecha: string; nombre: string }) => Promise<boolean>;
  onDelete?: (id: string) => Promise<boolean>;
}) {
  const [fecha, setFecha] = useState("");
  const [nombre, setNombre] = useState("");
  const agregar = () => {
    if (!fecha || !nombre.trim()) return;
    void onSave({ fecha, nombre });
    setFecha("");
    setNombre("");
  };
  const eliminar = (item: DiaFestivo) => {
    if (window.confirm(`¿Eliminar "${item.nombre}"? Dejará de resaltarse en el calendario.`)) void onDelete?.(item.id);
  };
  const ordenados = [...items].sort((a, b) => a.fecha.localeCompare(b.fecha));
  return (
    <article className="catalog-card festivos-card content-card">
      <header><span className="icon-tile blue"><CalendarDays size={18} /></span><div><h2>Días festivos</h2><p>Descanso obligatorio que se resalta en el calendario</p></div></header>
      <div className="catalog-list">
        {ordenados.length === 0 && <p className="empty-note">Sin elementos todavía.</p>}
        {ordenados.map((item) => (
          <div key={item.id}>
            <span className="catalog-dot" />
            <strong>{item.nombre}</strong>
            <code>{format(parseISO(item.fecha), "d MMM yyyy", { locale: es })}</code>
            {onDelete && (
              <div className="catalog-item-actions">
                <button className="icon-button subtle danger" type="button" onClick={() => eliminar(item)} disabled={actualizando} aria-label={`Eliminar ${item.nombre}`} title={`Eliminar ${item.nombre}`}><Trash2 size={14} /></button>
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="catalog-add festivo-add">
        <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} disabled={actualizando} aria-label="Fecha del día festivo" />
        <input value={nombre} onChange={(e) => setNombre(e.target.value)} onKeyDown={(e) => e.key === "Enter" && agregar()} placeholder="Nombre del festivo" disabled={actualizando} />
        <button className="icon-button" type="button" onClick={agregar} disabled={actualizando} aria-label="Agregar día festivo" title="Agregar día festivo"><Plus size={17} /></button>
      </div>
    </article>
  );
}

export function CatalogsView({ datos, actualizando, onSave, onDelete, onSaveFestivo, onDeleteFestivo }: CatalogsViewProps) {
  return (
    <div className="page-stack">
      <section className="page-title-row"><div><span className="eyebrow">Configuración</span><h1>Catálogos</h1><p>Elementos utilizados para organizar y filtrar al personal.</p></div></section>
      <section className="catalog-grid">
        {configuracion.map(({ tipo, ...resto }) => (
          <CatalogCard key={tipo} tipo={tipo} {...resto} items={datos[tipo]} actualizando={actualizando} onSave={onSave} onDelete={onDelete} />
        ))}
        <FestivosCard items={datos.diasFestivos} actualizando={actualizando} onSave={onSaveFestivo} onDelete={onDeleteFestivo} />
      </section>
    </div>
  );
}
