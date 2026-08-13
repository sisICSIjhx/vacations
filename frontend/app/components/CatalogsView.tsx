"use client";

import { useState } from "react";
import { BriefcaseBusiness, Building2, Check, MapPinned, Pencil, Plus, Trash2, X } from "lucide-react";
import type { Catalogo, DatosVacaciones } from "../types";

type Tipo = "sedes" | "proyectos" | "categorias";

interface CatalogsViewProps {
  datos: DatosVacaciones;
  actualizando: boolean;
  onSave: (tipo: Tipo, entrada: { id?: string; nombre: string }) => Promise<boolean>;
  onDelete: (tipo: Tipo, id: string) => Promise<boolean>;
}

const configuracion: Array<{ tipo: Tipo; titulo: string; descripcion: string; icono: typeof MapPinned }> = [
  { tipo: "sedes", titulo: "Sedes", descripcion: "Ubicaciones y centros de trabajo", icono: MapPinned },
  { tipo: "proyectos", titulo: "Proyectos", descripcion: "Asignaciones operativas vigentes", icono: BriefcaseBusiness },
  { tipo: "categorias", titulo: "Categorías", descripcion: "Administrativo, dual y operativo", icono: Building2 },
];

function CatalogItem({ item, actualizando, onSave, onDelete }: { item: Catalogo; actualizando: boolean; onSave: (nombre: string) => Promise<boolean>; onDelete: () => void }) {
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
        <button className="icon-button subtle" type="button" onClick={guardar} disabled={actualizando} aria-label="Guardar cambio"><Check size={15} /></button>
        <button className="icon-button subtle" type="button" onClick={cancelar} disabled={actualizando} aria-label="Cancelar edición"><X size={15} /></button>
      </div>
    );
  }

  return (
    <div>
      <span className="catalog-dot" style={item.color ? { background: item.color } : undefined} />
      <strong>{item.nombre}</strong>
      <code>{item.codigo}</code>
      <div className="catalog-item-actions">
        <button className="icon-button subtle" type="button" onClick={() => setEditando(true)} disabled={actualizando} aria-label={`Editar ${item.nombre}`}><Pencil size={14} /></button>
        <button className="icon-button subtle danger" type="button" onClick={onDelete} disabled={actualizando} aria-label={`Eliminar ${item.nombre}`}><Trash2 size={14} /></button>
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
  onDelete: (tipo: Tipo, id: string) => Promise<boolean>;
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
      void onDelete(tipo, item.id);
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
            onDelete={() => eliminar(item)}
          />
        ))}
      </div>
      <div className="catalog-add">
        <input value={nuevo} onChange={(e) => setNuevo(e.target.value)} onKeyDown={(e) => e.key === "Enter" && agregar()} placeholder={`Nueva ${titulo.toLowerCase().replace(/s$/, "")}`} disabled={actualizando} />
        <button className="icon-button" type="button" onClick={agregar} disabled={actualizando} aria-label={`Agregar ${titulo}`}><Plus size={17} /></button>
      </div>
    </article>
  );
}

export function CatalogsView({ datos, actualizando, onSave, onDelete }: CatalogsViewProps) {
  return (
    <div className="page-stack">
      <section className="page-title-row"><div><span className="eyebrow">Configuración</span><h1>Catálogos</h1><p>Elementos utilizados para organizar y filtrar al personal.</p></div></section>
      <section className="catalog-grid">
        {configuracion.map(({ tipo, ...resto }) => (
          <CatalogCard key={tipo} tipo={tipo} {...resto} items={datos[tipo]} actualizando={actualizando} onSave={onSave} onDelete={onDelete} />
        ))}
      </section>
    </div>
  );
}
