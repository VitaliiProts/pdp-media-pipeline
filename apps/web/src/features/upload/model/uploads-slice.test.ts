import {
  type Upload,
  uploadFailed,
  uploadsListed,
  uploadsSlice,
  uploadStarted,
  uploadSubmitted,
} from './uploads-slice';

const started = (id: string) =>
  uploadStarted({ id, fileName: `${id}.png`, kind: 'image', previewUrl: 'blob:1', createdAt: 1 });

describe('uploadsListed', () => {
  it('marks submitted uploads of the listed jobs and keeps them', () => {
    const state = [
      started('a'),
      uploadSubmitted({ id: 'a', jobId: 'job-a' }),
      started('b'),
      uploadSubmitted({ id: 'b', jobId: 'job-b' }),
      started('c'),
      uploadFailed({ id: 'c', problem: 'empty', detail: null }),
      uploadsListed(['job-a']),
    ].reduce(uploadsSlice.reducer, uploadsSlice.getInitialState());

    const byId = (id: string): Upload | undefined => state.entities[id];
    expect(byId('a')).toMatchObject({ phase: 'submitted', listed: true });
    expect(byId('b')).not.toHaveProperty('listed');
    expect(byId('c')).toMatchObject({ phase: 'failed' });
  });
});
