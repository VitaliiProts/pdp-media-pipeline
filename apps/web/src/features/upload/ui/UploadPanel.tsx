import { type ChangeEvent, type DragEvent, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppDispatch } from '../../../shared/lib/redux';
import { Checkbox } from '../../../shared/ui/choice/Checkbox';
import { ChoiceGroup } from '../../../shared/ui/choice/ChoiceGroup';
import { Radio } from '../../../shared/ui/choice/Radio';
import { ACCEPTED_TYPES, MAX_UPLOAD_BYTES, MAX_VIDEO_UPLOAD_BYTES } from '../lib/validate-file';
import {
  IMAGE_PRESETS,
  type ImagePreset,
  PRESET_LABEL_KEY,
  VIDEO_MODES,
  type VideoMode,
} from '../model/presets';
import { uploadFiles } from '../model/upload-files';
import styles from './UploadPanel.module.css';

const ALL_PRESETS = IMAGE_PRESETS.map((preset) => preset.name);

export function UploadPanel({ onSubmitted }: { onSubmitted?: (count: number) => void } = {}) {
  const { t } = useTranslation('upload');
  const dispatch = useAppDispatch();
  const [presets, setPresets] = useState<readonly ImagePreset[]>(ALL_PRESETS);
  const [videoMode, setVideoMode] = useState<VideoMode>('frames');
  const [isDragging, setIsDragging] = useState(false);
  const inputId = useId();
  const hasPresets = presets.length > 0;

  const submit = (files: FileList | null) => {
    if (!files?.length || !hasPresets) return;
    void dispatch(uploadFiles({ files: Array.from(files), presets, videoMode }));
    onSubmitted?.(files.length);
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
          {t('drop.limits', {
            maxMb: MAX_UPLOAD_BYTES / 1024 / 1024,
            maxVideoMb: MAX_VIDEO_UPLOAD_BYTES / 1024 / 1024,
          })}
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

      <div className={styles.options}>
        <ChoiceGroup legend={t('presets.legend')}>
          {IMAGE_PRESETS.map(({ name, width }) => (
            <Checkbox
              key={name}
              label={t(PRESET_LABEL_KEY[name])}
              detail={t('presets.width', { width })}
              checked={presets.includes(name)}
              onChange={() => togglePreset(name)}
            />
          ))}
          {!hasPresets && <p className={styles.warning}>{t('presets.required')}</p>}
        </ChoiceGroup>

        <ChoiceGroup legend={t('video.legend')}>
          {VIDEO_MODES.map((mode) => (
            <Radio
              key={mode}
              name={`${inputId}-video`}
              label={t(`video.${mode}`)}
              detail={t(`video.${mode}Detail`)}
              checked={videoMode === mode}
              onChange={() => setVideoMode(mode)}
            />
          ))}
        </ChoiceGroup>
      </div>
    </section>
  );
}
