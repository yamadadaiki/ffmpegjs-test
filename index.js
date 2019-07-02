const workerScript = 'ffmpeg-worker-mp4.js';
const worker = new Worker(workerScript);

let stdout = '';
let stderr = '';

// workerで動かしてるffmpegからのレスポンス
worker.onmessage = async (e) => {
  const {
    data: {
      type,
      data
    }
  } = e;
  switch (type) {
    case 'ready':
      await main();
      break;
    case 'stdout':
      stdout += data + '\n';
      break;
    case 'stderr':
      stderr += data + '\n';
      break;
    case 'done':
      console.log('done', e);
      break;
    case 'exit':
      console.log('Process exited with code ' + data);
      console.log(stdout);
      console.error(stderr);
      worker.terminate();
      break;
  }
};

/** workerの準備ができたときのメインの処理 */
async function main() {
  const state = {
    /** 録画中かどうか */
    isRecording: false,
    /** 最後にフレームを録画した時間(全フレームだと重たいので一部省くよう) */
    lastFrameRecordedTime: 0,
    /** 録画するフレーム */
    frames: []
  };

  await captureCameraFrame(400, 300, onFrameUpdate);
  addRecordingButton(false, onToggleRecording);

  /** カメラのフレームが更新されたらffmpegに渡すようのbytesを生成する */
  function onFrameUpdate(frameDataUri) {
    const currentTime = Date.now();
    // 毎フレーム入れると重たいので適当に省く
    if (state.isRecording && currentTime - 200 > state.lastFrameRecordedTime) {
      console.log('add frame');
      state.lastFrameRecordedTime = currentTime;

      // dataUri -> bytes array
      const raw = window.atob(frameDataUri.substring(23));
      const l = raw.length;
      const array = new Uint8Array(new ArrayBuffer(l));
      for (let i = 0; i < l; i += 1) {
        array[i] = raw.charCodeAt(i);
      }

      state.frames.push(array);
    }
  }

  /** 録画状態の切り替え */
  function onToggleRecording(isRecording) {
    state.isRecording = isRecording;

    if (isRecording) {
      // 録画開始
      state.frames.length = 0;
    } else {
      // 録画終了
      record(state.frames);
    }
  }

  /** 録画終了時にffmpegに渡す */
  function record(frames) {
    console.log(frames);

    worker.postMessage({
      type: 'run',
      TOTAL_MEMORY: 256 * 1024 * 1024,
      MEMFS: frames.map((frame, i) => ({
        name: `input${(i + 1).toString().padStart(3, '0')}.jpg`,
        data: frame
      })),
      // ffmpegのオプション
      arguments: [
        '-framerate', '10',
        '-i', 'input%3d.jpg',
        'out.mp4'
      ]
    });
  }
}

/** 毎フレームのカメラフレームをonFrameUpdateに渡す */
async function captureCameraFrame(width, height, onFrameUpdate) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: true,
    video: {
      width: { ideal: width },
      height: { ideal: height }
    }
  });

  // カメラと音声を流すvideo
  const $video = document.createElement('video');
  try {
    $video.srcObject = stream;
  } catch (exception) {
    $video.src = window.URL.createObjectURL(stream);
  }

  // 自動再生する
  try {
    $video.play();
  } catch (exception) {
    document.addEventListener('click', () => {
      $video.play();
    }, {
      once: true
    });
  }

  // 再生が始まるのを待つ
  await new Promise((resolve) => {
    $video.addEventListener('play', resolve, { once: true });
  });

  // ビデオの大きさがとれるまで待つ
  await new Promise(function waitForVideoSize(resolve) {
    if ($video.videoWidth * $video.videoHeight !== 0) {
      resolve();
      return;
    }
    setTimeout(() => waitForVideoSize(resolve), 100);
  });

  const $canvas = document.createElement('canvas');
  document.body.appendChild($canvas);
  $canvas.width = $video.videoWidth;
  $canvas.height = $video.videoHeight;
  // 顔がでかくて不快だったので小さくする
  $canvas.style.setProperty('transform', 'scale(0.3)');
  const ctx = $canvas.getContext('2d');

  (function loop() {
    ctx.drawImage($video, 0, 0);
    requestAnimationFrame(loop);
    onFrameUpdate($canvas.toDataURL('image/jpeg', 1));
  })();
}

/** 録画ボタンを作る */
function addRecordingButton(initialIsRecording, onToggleRecording) {
  let isRecording = initialIsRecording;

  const $button = document.createElement('button');
  document.body.appendChild($button);
  render(isRecording);

  // クリックのたびに録画状態を切り替える
  $button.addEventListener('click', () => {
    isRecording = !isRecording;
    render(isRecording);
    onToggleRecording(isRecording);
  });

  function render(isRecording) {
    $button.textContent = isRecording ? '終了' : '録画';
  }
}
