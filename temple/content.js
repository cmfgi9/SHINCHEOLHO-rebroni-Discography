// 온라인 법당 — 글 콘텐츠 (예불 순서 · 법문 · 오늘의 법구 · 발원 예시 · 오늘의 수행 · 처음 오신 분 안내)
// - 삼귀의·사홍서원의 한문 독송문은 전통 의식문(공유 저작물)이다.
// - 법문과 법구는 이 사이트가 직접 쓴 묵상 글이다. 법구는 법구경 게송의 뜻을 바탕으로 풀어 쓴 것이며 번역본 인용이 아니다.
//   (경전 번역본은 저작권이 있을 수 있으므로 새 글을 넣을 때도 원문 번역을 그대로 옮기지 말 것)

// ---------- 예불 순서 ----------
// kind: seat(자리에 앉기) · chant(한 줄씩 읽고 절) · sit(입정) · talk(법문) · vow(발원) · end(회향)
export const YEBUL = [
  {
    kind: "seat", ko: "자리에 앉기", en: "Take a seat",
    body: "대웅전 좌복에 앉아 숨을 고르고 마음을 모아요. 아래 버튼을 누르면 가까운 빈 좌복으로 걸어가 앉아요.",
    bodyEn: "Sit on a cushion in the main hall and gather your mind."
  },
  {
    kind: "chant", ko: "삼귀의", hanja: "三歸依", en: "Taking refuge",
    body: "부처님과 가르침과 스님들께 귀의하며, 한 줄마다 절을 올려요.",
    bodyEn: "Take refuge in the Buddha, the Dharma and the Sangha, bowing once for each line.",
    lines: [
      { chant: "귀의불 양족존", hanja: "歸依佛 兩足尊", mean: "거룩한 부처님께 귀의합니다", en: "I take refuge in the Buddha" },
      { chant: "귀의법 이욕존", hanja: "歸依法 離欲尊", mean: "거룩한 가르침에 귀의합니다", en: "I take refuge in the Dharma" },
      { chant: "귀의승 중중존", hanja: "歸依僧 衆中尊", mean: "거룩한 스님들께 귀의합니다", en: "I take refuge in the Sangha" }
    ],
    bowEach: true
  },
  {
    kind: "sit", ko: "입정", hanja: "入定", en: "Silent sitting", secs: 60,
    body: "죽비 소리에 맞춰 1분 동안 조용히 앉아요. 숨이 들어오고 나가는 것만 가만히 바라봐요.",
    bodyEn: "Sit quietly for one minute, simply watching the breath."
  },
  {
    kind: "talk", ko: "법문", hanja: "法門", en: "Dharma talk",
    body: "오늘의 짧은 법문을 읽거나 들어요.",
    bodyEn: "Read or listen to today's short talk."
  },
  {
    kind: "vow", ko: "발원", hanja: "發願", en: "Making a vow",
    body: "마음에 품은 바람을 하나 골라 조용히 올려요. 직접 적은 발원은 이 기기에만 간직되고 어디에도 보내지 않아요.",
    bodyEn: "Offer a wish of your heart. Anything you write stays on this device only."
  },
  {
    kind: "chant", ko: "사홍서원", hanja: "四弘誓願", en: "The four great vows",
    body: "모든 이와 함께 걸어가겠다는 네 가지 큰 서원을 새겨요. 마치면 절을 한 번 올려요.",
    bodyEn: "Recite the four great vows, then bow once.",
    lines: [
      { chant: "중생무변서원도", hanja: "衆生無邊誓願度", mean: "가없는 중생을 다 건지오리다", en: "Beings are numberless; I vow to free them" },
      { chant: "번뇌무진서원단", hanja: "煩惱無盡誓願斷", mean: "끝없는 번뇌를 다 끊으오리다", en: "Delusions are endless; I vow to end them" },
      { chant: "법문무량서원학", hanja: "法門無量誓願學", mean: "한없는 법문을 다 배우오리다", en: "Dharma gates are boundless; I vow to learn them" },
      { chant: "불도무상서원성", hanja: "佛道無上誓願成", mean: "위없는 불도를 다 이루오리다", en: "The Buddha way is unsurpassable; I vow to attain it" }
    ],
    bowEnd: true
  },
  {
    kind: "end", ko: "회향", hanja: "廻向", en: "Dedication",
    body: "오늘 지은 작은 공덕을 모든 이웃과 나눕니다. 이 자리에 함께한 모든 이가 평안하기를.",
    bodyEn: "We share today's merit with everyone. May all beings be at peace."
  }
];

// ---------- 법문 (직접 쓴 짧은 글 · 날마다 바뀜) ----------
export const TALKS = [
  {
    title: "지금 이 숨 하나", en: "Just this breath",
    text: [
      "우리는 하루에도 수없이 어제를 되짚고 내일을 걱정합니다.",
      "그런데 지금 이 순간 우리가 실제로 가진 것은 들어오고 나가는 숨 하나뿐입니다.",
      "숨은 과거에서 오지 않고, 미래로 미뤄지지도 않습니다.",
      "마음이 어지러울 때 숨 하나로 돌아오면, 흩어진 마음이 제자리를 찾습니다.",
      "오늘 하루, 문득 생각이 날 때마다 세 번만 천천히 숨을 쉬어 보세요.",
      "그 세 번의 숨이 하루를 지켜 주는 작은 법당이 됩니다."
    ]
  },
  {
    title: "내려놓는다는 것", en: "On letting go",
    text: [
      "무거운 짐을 들고 오래 걸으면 팔이 아프다는 것을 우리는 압니다.",
      "그런데 마음의 짐은 내려놓으면 큰일이 날 것처럼 꼭 쥐고 있습니다.",
      "내려놓는다는 것은 포기하는 것이 아니라, 잠시 땅에 두고 숨을 고르는 일입니다.",
      "섭섭함과 서운함도 한번 바닥에 내려놓고 바라보면 생각보다 가볍습니다.",
      "오늘 하나만 내려놓아 보세요. 다시 들어야 한다면 그때 들어도 늦지 않습니다."
    ]
  },
  {
    title: "나에게 먼저 자비를", en: "Kindness begins with yourself",
    text: [
      "남에게는 너그러우면서 자기 자신에게는 유난히 엄격한 분들이 많습니다.",
      "자비는 바깥으로만 흐르는 물이 아닙니다. 샘이 마르면 아무것도 흘려보낼 수 없습니다.",
      "실수한 나에게 '괜찮다, 다시 해 보자'고 말해 주는 것도 수행입니다.",
      "오늘은 거울 속 나에게 다정한 한마디를 건네 보세요.",
      "나를 품을 수 있는 만큼 이웃도 품을 수 있습니다."
    ]
  },
  {
    title: "고마운 인연", en: "Grateful for connections",
    text: [
      "밥 한 그릇에도 햇볕과 비, 농부의 땀, 밥을 지은 손길이 모여 있습니다.",
      "우리는 혼자 사는 것 같지만, 수많은 인연이 오늘의 나를 받치고 있습니다.",
      "고마움을 알아차리는 순간 마음은 저절로 넉넉해집니다.",
      "오늘 고마운 사람 한 명을 떠올리고, 마음속으로 '고맙습니다' 하고 말해 보세요.",
      "그 한마디가 돌고 돌아 다시 나에게 돌아옵니다."
    ]
  },
  {
    title: "변하기에 소중한 것", en: "Precious because it changes",
    text: [
      "꽃은 지기 때문에 피어 있는 지금이 더 아름답습니다.",
      "기쁜 일도 지나가고, 힘든 일도 지나갑니다.",
      "모든 것이 변한다는 사실은 슬픈 일이 아니라 희망의 다른 이름입니다.",
      "지금 힘들다면, 이 또한 지나간다는 것을 기억하세요.",
      "지금 행복하다면, 그 순간을 충분히 누리세요. 그것이 변하는 세상을 사는 지혜입니다."
    ]
  }
];

// ---------- 오늘의 법구 (법구경 게송의 뜻을 바탕으로 직접 풀어 쓴 글) ----------
export const BEOPGU = [
  { ref: "법구경 제1게", text: "모든 일은 마음이 앞서 이끕니다. 흐린 마음으로 말하고 행하면 괴로움이 수레바퀴처럼 뒤따릅니다.", reflect: "오늘 내 마음은 어떤 빛깔로 하루를 시작했나요?" },
  { ref: "법구경 제2게", text: "맑은 마음으로 말하고 행하면, 그림자가 몸을 떠나지 않듯 기쁨이 늘 곁에 머뭅니다.", reflect: "맑은 마음으로 건넬 수 있는 말 한마디를 떠올려 보세요." },
  { ref: "법구경 제5게", text: "미움은 미움으로 그치지 않습니다. 미움을 내려놓을 때 비로소 미움이 그칩니다.", reflect: "마음속에 남은 작은 미움 하나를 살며시 내려놓아 보세요." },
  { ref: "법구경 제33·34게", text: "마음은 물 밖에 나온 물고기처럼 이리저리 퍼덕입니다. 지혜로운 이는 그 마음을 곧게 다듬습니다.", reflect: "지금 마음이 어디로 달아나 있는지 알아차려 보세요." },
  { ref: "법구경 제35게", text: "붙잡기 어렵고 가볍게 날아다니는 마음을 다스리면 그것이 곧 즐거움이 됩니다.", reflect: "숨 세 번으로 마음을 제자리에 데려와 보세요." },
  { ref: "법구경 제43게", text: "부모도 친척도 해 줄 수 없는 큰 도움을 바르게 세운 내 마음은 해 줄 수 있습니다.", reflect: "오늘 나를 돕는 한 가지 생각은 무엇인가요?" },
  { ref: "법구경 제50게", text: "남이 한 일과 하지 않은 일을 따지기보다, 내가 한 일과 하지 않은 일을 살펴봅니다.", reflect: "오늘 내가 할 수 있는 작은 선행 하나를 정해 보세요." },
  { ref: "법구경 제80게", text: "물길을 내는 이는 물을 이끌고, 목수는 나무를 다듬듯, 지혜로운 이는 자기 자신을 다듬습니다.", reflect: "오늘 다듬고 싶은 나의 습관 하나는 무엇인가요?" },
  { ref: "법구경 제100게", text: "뜻 없는 천 마디 말보다, 들으면 마음이 고요해지는 한마디가 더 귀합니다.", reflect: "누군가에게 고요함을 줄 수 있는 한마디를 건네 보세요." },
  { ref: "법구경 제103게", text: "전쟁터에서 천 명을 이기는 것보다 자기 자신 하나를 이기는 이가 가장 큰 승리자입니다.", reflect: "오늘 나를 이기는 작은 순간을 만들어 보세요." },
  { ref: "법구경 제122게", text: "물방울이 하나씩 떨어져 항아리를 채우듯, 작은 선행이 모여 큰 복이 됩니다.", reflect: "작아서 지나쳤던 선행 하나를 오늘 해 보세요." },
  { ref: "법구경 제129게", text: "모두가 아픔을 두려워합니다. 나를 남의 자리에 놓아 보면 남을 아프게 할 수 없습니다.", reflect: "오늘 만나는 사람의 자리에 잠시 서 보세요." },
  { ref: "법구경 제160게", text: "나를 의지할 곳은 바로 나 자신입니다. 잘 다스린 나는 가장 든든한 의지처가 됩니다.", reflect: "스스로에게 '괜찮아, 잘하고 있어'라고 말해 주세요." },
  { ref: "법구경 제183게", text: "나쁜 일을 하지 않고, 좋은 일을 행하며, 마음을 맑게 하는 것. 이것이 모든 부처님의 가르침입니다.", reflect: "세 가지 중 오늘 가장 마음이 가는 것은 무엇인가요?" },
  { ref: "법구경 제197게", text: "미워하는 이들 가운데서도 미워하지 않으며 우리는 즐겁게 살아갑니다.", reflect: "불편한 사람을 떠올리며 '그도 평안하기를' 하고 빌어 보세요." },
  { ref: "법구경 제204게", text: "건강은 가장 큰 선물이고, 만족은 가장 큰 재산이며, 믿음은 가장 좋은 벗입니다.", reflect: "지금 이미 충분히 가진 것 세 가지를 꼽아 보세요." },
  { ref: "법구경 제223게", text: "성냄은 성내지 않음으로, 나쁨은 착함으로, 인색함은 베풂으로, 거짓은 참으로 이깁니다.", reflect: "오늘 성냄 대신 고를 수 있는 마음은 무엇인가요?" },
  { ref: "법구경 제277게", text: "만들어진 모든 것은 변합니다. 이것을 지혜로 바라볼 때 괴로움에서 벗어납니다.", reflect: "변해서 오히려 다행이었던 일을 떠올려 보세요." },
  { ref: "법구경 제354게", text: "모든 베풂 가운데 진리를 나누는 베풂이 으뜸이고, 모든 기쁨 가운데 진리의 기쁨이 으뜸입니다.", reflect: "오늘 배운 좋은 생각 하나를 누군가와 나눠 보세요." },
  { ref: "법구경 제25게", text: "부지런함과 절제로 스스로 섬을 만드세요. 어떤 물결도 그 섬을 휩쓸지 못합니다.", reflect: "흔들릴 때 돌아갈 나만의 섬은 무엇인가요?" }
];

// ---------- 발원 예시 ----------
export const VOW_PRESETS = [
  "가족이 모두 건강하고 평안하기를",
  "오늘 만난 모든 이가 행복하기를",
  "아픈 이들이 하루빨리 낫기를",
  "미운 마음이 자비로 바뀌기를",
  "흔들리는 마음이 고요해지기를",
  "세상의 모든 생명이 평안하기를"
];

// ---------- 오늘의 수행 (매일 새로) ----------
export const TASKS = [
  { id: "hap", ko: "🙏 합장하기", en: "Join your palms" },
  { id: "bow3", ko: "🙇 절 세 번 올리기", en: "Bow three times" },
  { id: "greet", ko: "💬 이웃에게 인사하기", en: "Greet someone" },
  { id: "practice", ko: "📋 예불 또는 🕊️ 1분 명상", en: "Join the service or sit for one minute" },
  { id: "offer", ko: "🪷 공양 올리기 또는 음식 나누기", en: "Make an offering or share food" }
];

// ---------- 처음 오신 분 안내 ----------
export const GUIDE = [
  ["🚶 이동", "방향키·WASD 또는 가고 싶은 곳을 누르면 걸어가요. 석탑이나 나무에 막히면 옆으로 비켜 가요.", "Arrow keys / WASD, or tap where you want to go."],
  ["🙏 동작", "합장·절하기·인사(정해진 말풍선)를 할 수 있어요. 오늘 올린 절 수는 108배를 목표로 세어 드려요.", "Join palms, bow and greet. Your bows count toward 108."],
  ["🏯 대웅전", "안에 들어가면 지붕이 흐려져요. 좌복에 앉고, 목탁을 치고, 법사 스님 곁에서 예불을 드릴 수 있어요.", "Sit on cushions, strike the moktak and join the service."],
  ["🔔 범종각", "범종을 치면 지금 법당에 있는 모든 사람에게 종소리가 들려요.", "The temple bell is heard by everyone here."],
  ["🏮 연등", "마당의 연등 줄 아래에서 연등을 달면 하루 동안 모두에게 보여요(하루 3개까지).", "Lanterns glow for everyone for a day."],
  ["🪷 공양 올리기", "대웅전 불단 앞 공양상에 공양미·초·향·꽃을 올릴 수 있어요. 오늘 모두가 올린 공양이 공양상에 쌓여 보여요.", "Offer rice, a candle, incense or flowers at the altar."],
  ["🍚 공양간", "대웅전 동쪽(오른쪽) 공양간에서 밥·차·떡·과일을 받아, 자리에 앉아 들거나 가까운 이웃에게 나눠 줄 수 있어요.", "Get food in the refectory to the east, then eat or share it."],
  ["📿 수행", "아래 📿 수행 메뉴에서 예불·1분 명상·오늘의 법구·발원 노트·오늘의 수행을 만날 수 있어요.", "Find the service, meditation, verses and your vow notes in the practice menu."],
  ["👣 함께", "위쪽 🪷 법당 표시를 누르면 다른 법당으로 옮기거나 주소를 복사해 친구와 같은 법당에서 만날 수 있어요. 절 수를 누르면 오늘의 흔적(다녀간 이웃·공양·나눔)을 볼 수 있어요.", "Tap the hall badge to switch halls; tap your bow count for today's traces."],
  ["🔒 안심하세요", "자유 채팅이 없고, 발원 노트는 이 기기에만 저장돼요. 법당에 있는 동안 캐릭터·이름·위치만 다른 사람에게 보여요. 오늘 다녀간 이름은 이틀 뒤 지워지고, 남기지 않을 수도 있어요.", "No free chat; vow notes stay on your device."]
];
