import type { NextbotSlot } from './slots.ts';

export type EditorTab = 'basic' | 'image' | 'video' | 'audio';

export interface EditorGuide {
  imageEmpty: boolean;
  videoEmpty: boolean;
  audioEmpty: boolean;
  needsVideoCapture: boolean;
  imageMessage: string;
  nextAction: string;
  imageState: 'empty' | 'pending' | 'ready';
  videoState: 'empty' | 'ready';
  audioState: 'empty' | 'pending' | 'ready';
}

export function editorTabGuide(slot: NextbotSlot, hasCapturedVideoFrame: boolean): EditorGuide {
  const visual = slot.visual;
  const audio = slot.audio;
  const needsVideoCapture = visual?.sourceFormat === 'video' && !hasCapturedVideoFrame;
  const hasEditableImage = Boolean(visual && !needsVideoCapture);
  const hasVideo = visual?.sourceFormat === 'video';
  const imageState = !visual ? 'empty' : visual.processed ? 'ready' : 'pending';
  const audioState = !audio ? 'empty' : audio.processed ? 'ready' : 'pending';
  let nextAction: string;
  if (!visual) nextAction = '次にすること：基本設定で顔画像・GIF・動画を登録しよう。';
  else if (needsVideoCapture && !visual.processed) nextAction = '次にすること：動画タブで好きな場面を取り込もう。';
  else if (!visual.processed) nextAction = '次にすること：画像・GIFタブで編集を適用しよう。';
  else if (!audio) nextAction = '次にすること：基本設定で音声（効果音）を登録しよう。';
  else if (!audio.processed) nextAction = '次にすること：音声タブでOGGへ変換しよう。';
  else nextAction = '素材が揃ったよ！必要なら編集して、一覧へ戻ろう。';
  return {
    imageEmpty: !hasEditableImage,
    videoEmpty: !hasVideo,
    audioEmpty: !audio,
    needsVideoCapture,
    imageMessage: needsVideoCapture
      ? '動画タブでフレームを取り込むと、ここで切り抜き・背景透過ができます。'
      : '基本設定でPNG・GIFを登録すると、ここで画像・アニメーションを編集できます。',
    nextAction,
    imageState,
    videoState: hasVideo ? 'ready' : 'empty',
    audioState,
  };
}
