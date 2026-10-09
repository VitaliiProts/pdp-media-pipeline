import { type ChangeEvent, type DragEvent, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppDispatch } from '../../../shared/lib/redux';
import { ACCEPTED_TYPES, MAX_UPLOAD_BYTES } from '../lib/validate-file';
import { IMAGE_PRESETS, type ImagePreset, PRESET_LABEL_KEY } from '../model/presets';
import { uploadImages } from '../model/upload-images';
import styles from './UploadPanel.module.css';

const ALL_PRESETS = IMAGE_PRESETS.map((preset) => preset.name);

export function UploadPanel() {
  const { t } = useTranslation('upload');
  const dispatch = useAppDispatch();
  const [presets, setPresets] = useState<readonly ImagePreset[]>(ALL_PRESETS);
  const [isDragging, setIsDragging] = useState(false);
  const inputId = useId();
  const hasPresets = presets.length > 0;

  const submit = (files: FileList | null) => {
    if (!files?.length || !hasPresets) return;
    void dispatch(uploadImages({ files: Array.from(files), presets }));
  };

  const togglePreset = (name: ImagePreset) =>
    setPresets((current) =>
      current.includes(name) ? current.filter((p) => p !== name) : [...current, name],
    );

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    submit(event.target.files);
    event.target.value = '';
  };

  const handleDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setIsDragging(false);
    submit(event.dataTransfer.files);
  };

  const handleDragOver = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setIsDragging(true);
  };

  return (
    <section className={styles.panel} aria-labelledby={`${inputId}-title`}>
      <label
        htmlFor={inputId}
        className={styles.table}
        data-dragging={isDragging}
        data-disabled={!hasPresets}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={() => setIsDragging(false)}
      >
        <span id={`${inputId}-title`} className={styles.call}>
          {t('drop.title')}
        </span>
        <span className={styles.limits}>
          {t('drop.limits', { maxMb: MAX_UPLOAD_BYTES / 1024 / 1024 })}
        </span>
        <input
          id={inputId}
          className={styles.input}
          type="file"
          multiple
          accept={ACCEPTED_TYPES.join(',')}
          disabled={!hasPresets}
          onChange={handleChange}
        />
      </label>

      <fieldset className={styles.presets}>
        <legend className={styles.legend}>{t('presets.legend')}</legend>
        {IMAGE_PRESETS.map(({ name, width }) => (
          <label key={name} className={styles.preset}>
            <input
              type="checkbox"
              checked={presets.includes(name)}
              onChange={() => togglePreset(name)}
            />
            <span className={styles.presetName}>{t(PRESET_LABEL_KEY[name])}</span>
            <span className={styles.presetWidth}>{t('presets.width', { width })}</span>
          </label>
        ))}
        {!hasPresets && <p className={styles.warning}>{t('presets.required')}</p>}
      </fieldset>
    </section>
  );
}
