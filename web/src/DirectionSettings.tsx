import { useState } from 'react'
import { ArrowUp, ArrowDown, Plus, Trash2 } from 'lucide-react'
import { groupNames, orderedSections, type Diary } from './diary-model'

export default function DirectionSettings({ data, busy, onSave }: { data: Diary; busy: boolean; onSave(value: Diary): Promise<void> }) {
  const [names, setNames] = useState(() => groupNames(data))
  const [keys, setKeys] = useState(() => groupNames(data).map((_, index) => index))
  const [sections, setSections] = useState(() => orderedSections(data).map(s => ({ ...s, groupKey: groupNames(data).indexOf(s.group) })))
  const [newGroup, setNewGroup] = useState('')
  const valid = names.every(n => n.trim()) && new Set(names.map(n => n.trim())).size === names.length && sections.every(s => s.title.trim())
  function moveGroup(index: number, offset: number) {
    const next = [...names]; [next[index], next[index + offset]] = [next[index + offset], next[index]]; setNames(next)
    const nextKeys = [...keys]; [nextKeys[index], nextKeys[index + offset]] = [nextKeys[index + offset], nextKeys[index]]; setKeys(nextKeys)
  }
  function moveSection(id: string, offset: number) {
    const next = [...sections], index = next.findIndex(s => s.id === id), peers = next.filter(s => s.groupKey === next[index].groupKey)
    const other = next.findIndex(s => s.id === peers[peers.findIndex(s => s.id === id) + offset].id)
    ;[next[index], next[other]] = [next[other], next[index]]; setSections(next)
  }
  return <form className="d-form d-direction-settings" onSubmit={e => {
    e.preventDefault()
    void onSave({ ...data, groups: names.map(n => n.trim()), sections: sections.map(({ groupKey, ...s }, position) => ({ ...s, title: s.title.trim(), group: names[keys.indexOf(groupKey)].trim(), position })) })
  }}><p className="d-hint">Назовите группы по-своему и расставьте их в удобном порядке. Стрелки меняют порядок групп и направлений. Задачи и отметки сохраняются.</p><fieldset disabled={busy}>
    {names.map((name, index) => <section className="d-direction-group" key={keys[index]}>
      <div className="d-direction-group-head"><label>Название группы<input aria-label={`Название группы ${index + 1}`} maxLength={80} required value={name} onChange={e => {
        setNames(names.map((n, i) => i === index ? e.target.value : n))
      }} /></label><button type="button" aria-label={`Поднять группу ${name}`} disabled={!index} onClick={() => moveGroup(index, -1)}><ArrowUp size={17} /></button><button type="button" aria-label={`Опустить группу ${name}`} disabled={index === names.length - 1} onClick={() => moveGroup(index, 1)}><ArrowDown size={17} /></button><button type="button" aria-label={`Удалить группу ${name}`} disabled={sections.some(s => s.groupKey === keys[index])} title="Можно удалить пустую группу. Сначала переместите направления в другую группу." onClick={() => { setNames(names.filter((_, i) => i !== index)); setKeys(keys.filter((_, i) => i !== index)) }}><Trash2 size={17} /></button></div>
      {sections.filter(s => s.groupKey === keys[index]).map((s, position, peers) => <div className="d-direction-row" key={s.id}><label>Направление<input aria-label={`Название направления ${s.title}`} maxLength={160} required value={s.title} onChange={e => setSections(sections.map(v => v.id === s.id ? { ...v, title: e.target.value } : v))} /></label><label>Группа<select aria-label={`Группа направления ${s.title}`} value={s.groupKey} onChange={e => setSections(sections.map(v => v.id === s.id ? { ...v, groupKey: Number(e.target.value) } : v))}>{names.map((n, i) => <option key={keys[i]} value={keys[i]}>{n || 'Без названия'}</option>)}</select></label><button type="button" aria-label={`Поднять направление ${s.title}`} disabled={!position} onClick={() => moveSection(s.id, -1)}><ArrowUp size={16} /></button><button type="button" aria-label={`Опустить направление ${s.title}`} disabled={position === peers.length - 1} onClick={() => moveSection(s.id, 1)}><ArrowDown size={16} /></button></div>)}
      {!sections.some(s => s.groupKey === keys[index]) && <p className="d-hint">Пустая группа — можно добавить направления или удалить её.</p>}
    </section>)}
    <div className="d-add-group"><label>Новая группа<input maxLength={80} value={newGroup} placeholder="Например, Для себя" onChange={e => setNewGroup(e.target.value)} /></label><button type="button" className="d-secondary" disabled={!newGroup.trim() || names.some(n => n.trim() === newGroup.trim())} onClick={() => { setNames([...names, newGroup.trim()]); setKeys([...keys, Math.max(-1, ...keys) + 1]); setNewGroup('') }}><Plus size={16} />Добавить группу</button></div>
    {!valid && <p role="alert" className="d-hint">Названия не должны быть пустыми, а названия групп — повторяться.</p>}
    <button className="d-primary" disabled={!valid}>Сохранить порядок и группы</button>
  </fieldset></form>
}
