import type { NextbotSlot } from './slots.ts';

export type EditorTab = 'image' | 'audio';

export interface EditorGuide {
  needsVideoCapture: boolean;
  nextAction: string;
  imageState: 'empty' | 'pending' | 'ready';
  audioState: 'empty' | 'pending' | 'ready';
}

export function editorTabGuide(slot: NextbotSlot, hasCapturedVideoFrame: boolean): EditorGuide {
  const visual = slot.visual;
  const audio = slot.audio;
  const needsVideoCapture = visual?.sourceFormat === 'video' && !hasCapturedVideoFrame && !visual.processed;
  const imageState = !visual ? 'empty' : visual.processed ? 'ready' : 'pending';
  const audioState = !audio ? 'empty' : audio.processed ? 'ready' : 'pending';

  let nextAction: string;
  if (!visual) nextAction = '次にすること：画像タブで顔画像・GIF・動画を登録しよう。';
  else if (needsVideoCapture) nextAction = '次にすること：画像タブの動画プレビューから好きな場面を取り込もう。';
  else if (!visual.processed) nextAction = '次にすること：画像タブで編集を適用しよう。';
  else if (!audio) nextAction = '次にすること：音声タブで効果音を登録しよう。';
  else if (!audio.processed) nextAction = '次にすること：音声タブでOGGへ変換しよう。';
  else nextAction = '素材が揃ったよ！必要なら画像・音声を調整して、一覧へ戻ろう。';

  return { needsVideoCapture, nextAction, imageState, audioState };
}
