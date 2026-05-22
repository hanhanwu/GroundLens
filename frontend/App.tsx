import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  ActivityIndicator,
  Easing,
  Image,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

type QAPair = {
  span: string;
  question: string;
  answer: string;
};

type ApprovedRecord = {
  topic: string;
  query: string;
  context: string;
  answer: string;
  docId: string;
};

type KnowledgeDocument = {
  id: string;
  title: string;
  content: string;
  topicSpans: Record<string, string[]>;
  qaPairs: QAPair[];
};

type ReviewItem = {
  topic: string;
  topicIndex: number;
  doc: KnowledgeDocument;
  qaPair: QAPair;
  palette: { bg: string; border: string; text: string };
};

type BatchDocumentsResponse = {
  documents: KnowledgeDocument[];
};

type ContentBlock = {
  kind: 'heading' | 'paragraph';
  text: string;
};

const BACKEND_URL =
  Platform.OS === 'android' ? 'http://10.0.2.2:8000' : 'http://localhost:8000';

const logoSource = require('./assets/icon.png');

const sectionMarkers = [
  'Before you begin:',
  'Important:',
  'Note:',
  'Tip:',
  'Want some inspiration creating your campaign?',
];

const stepBodyStarters = [
  'Once',
  'Depending',
  'Pick',
  'Choose',
  'Review',
];

const STEP_SECTION_RE = new RegExp(
  `^((Step \\d+ \\| .*?))(${stepBodyStarters.join('|')})\\b(.*)$`
);

function splitStepSection(section: string): ContentBlock[] {
  const match = section.match(STEP_SECTION_RE);

  if (!match) {
    return [{ kind: 'heading', text: section }];
  }

  return [
    { kind: 'heading', text: match[1].trim() },
    { kind: 'paragraph', text: `${match[3]}${match[4]}`.trim() },
  ];
}

function formatContent(content: string): ContentBlock[] {
  let formatted = content.replace(/\s*(Step \d+ \|)/g, '\n\n$1');

  sectionMarkers.forEach((marker) => {
    formatted = formatted.split(marker).join(`\n\n${marker}\n\n`);
  });

  return formatted
    .split(/\n{2,}/)
    .map((section) => section.trim())
    .filter(Boolean)
    .flatMap((section) => {
      if (section.startsWith('Step ')) {
        return splitStepSection(section);
      }

      if (sectionMarkers.some((marker) => section === marker)) {
        return [{ kind: 'heading', text: section }];
      }

      return [{ kind: 'paragraph', text: section }];
    });
}

function getDocumentBody(content: string) {
  return content.split(/\r?\n/).slice(1).join('\n').trim();
}

function BrandLogo() {
  return (
    <View style={styles.brandRow}>
      <Image source={logoSource} style={styles.logo} />
      <Text style={styles.brand}>GroundLens</Text>
    </View>
  );
}

// Fireworks burst particles for the completion celebration
const FIREWORK_PARTICLES = [
  // inner ring
  { emoji: '🎉', tx: -200, ty: -290, delay:   0 },
  { emoji: '🥳', tx: -120, ty: -335, delay:  50 },
  { emoji: '💯', tx:  -25, ty: -355, delay:  20 },
  { emoji: '🎊', tx:   65, ty: -345, delay:  70 },
  { emoji: '👏', tx:  155, ty: -305, delay:  30 },
  { emoji: '🍾', tx:  220, ty: -265, delay:  90 },
  // mid ring
  { emoji: '✨', tx: -255, ty: -240, delay: 110 },
  { emoji: '🏆', tx: -165, ty: -195, delay:  60 },
  { emoji: '🎉', tx:   10, ty: -235, delay:  45 },
  { emoji: '🎊', tx:  130, ty: -205, delay:  80 },
  { emoji: '✨', tx:  215, ty: -215, delay:  15 },
  { emoji: '💯', tx:  265, ty: -165, delay: 130 },
  // outer scatter
  { emoji: '🥳', tx: -285, ty: -155, delay: 140 },
  { emoji: '🎉', tx: -225, ty: -365, delay:  35 },
  { emoji: '🍾', tx:   90, ty: -375, delay:  65 },
  { emoji: '👏', tx:  180, ty: -355, delay: 100 },
  { emoji: '✨', tx:  -80, ty: -175, delay: 120 },
  { emoji: '🏆', tx:  245, ty: -130, delay: 155 },
  { emoji: '🎊', tx: -315, ty: -220, delay:  75 },
  { emoji: '💯', tx:  305, ty: -250, delay:  40 },
] as const;

const TOPIC_COLORS: { bg: string; border: string; text: string }[] = [
  { bg: '#FEF9C3', border: '#EAB308', text: '#78350F' }, // vivid yellow
  { bg: '#FCE7F3', border: '#EC4899', text: '#831843' }, // vivid pink
  { bg: '#CCFBF1', border: '#14B8A6', text: '#134E4A' }, // vivid teal
  { bg: '#DBEAFE', border: '#3B82F6', text: '#1E3A8A' }, // vivid blue
  { bg: '#F3E8FF', border: '#9333EA', text: '#581C87' }, // vivid purple
  { bg: '#FFEDD5', border: '#F97316', text: '#7C2D12' }, // vivid orange
];

type ColoredTopic = { text: string; color: string; palette: { bg: string; border: string; text: string }; spans: string[] };

function HighlightedText({ text, topics }: { text: string; topics: ColoredTopic[] }) {
  const ranges: { start: number; end: number; color: string }[] = [];

  for (const { color, spans } of topics) {
    for (const span of spans) {
      if (!span) continue;
      let idx = text.indexOf(span);
      while (idx !== -1) {
        ranges.push({ start: idx, end: idx + span.length, color });
        idx = text.indexOf(span, idx + 1);
      }
    }
  }

  if (ranges.length === 0) {
    return <Text>{text}</Text>;
  }

  ranges.sort((a, b) => a.start - b.start);
  const merged: { start: number; end: number; color: string }[] = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (!last || range.start > last.end) {
      merged.push({ ...range });
    } else if (range.end > last.end) {
      last.end = range.end;
    }
  }

  const segments: { text: string; color: string | null }[] = [];
  let cursor = 0;
  for (const { start, end, color } of merged) {
    if (start > cursor) segments.push({ text: text.slice(cursor, start), color: null });
    segments.push({ text: text.slice(start, end), color });
    cursor = end;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), color: null });

  return (
    <Text>
      {segments.map((segment, index) => (
        <Text
          key={`${segment.text}-${index}`}
          style={segment.color ? { backgroundColor: segment.color, color: '#111827' } : undefined}
        >
          {segment.text}
        </Text>
      ))}
    </Text>
  );
}

function UploadPage({ onNext }: { onNext: () => void }) {
  const [files, setFiles] = useState<File[]>([]);
  const [uploadState, setUploadState] = useState<'idle' | 'uploading' | 'done'>('idle');
  const [uploadedCount, setUploadedCount] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const dropZoneRef = useRef<View>(null);

  // Refs so the one-time DOM listeners always see the freshest values
  const uploadStateRef = useRef(uploadState);
  uploadStateRef.current = uploadState;
  const startUploadRef = useRef<((f: File[]) => void) | null>(null);

  const isIdle = uploadState === 'idle';
  const isUploading = uploadState === 'uploading';
  const isDone = uploadState === 'done';
  const progressPct = files.length > 0 ? Math.round((uploadedCount / files.length) * 100) : 0;

  // Native DOM drag listeners — bypasses React Native Web's synthetic event limitations.
  // e.preventDefault() in dragover is REQUIRED by the browser to allow drops.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const el = dropZoneRef.current as unknown as HTMLElement;
    if (!el) return;

    const handleDragOver = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (uploadStateRef.current === 'idle') setIsDragging(true);
    };
    const handleDragEnter = (e: DragEvent) => {
      e.preventDefault();
      if (uploadStateRef.current === 'idle') setIsDragging(true);
    };
    const handleDragLeave = (e: DragEvent) => {
      // Only clear when the cursor leaves the zone itself, not a child element
      if (!el.contains(e.relatedTarget as Node)) setIsDragging(false);
    };
    const handleDrop = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
      if (uploadStateRef.current !== 'idle') return;
      const dropped = e.dataTransfer?.files;
      if (dropped && dropped.length > 0) startUploadRef.current?.(Array.from(dropped));
    };

    el.addEventListener('dragover', handleDragOver);
    el.addEventListener('dragenter', handleDragEnter);
    el.addEventListener('dragleave', handleDragLeave);
    el.addEventListener('drop', handleDrop);
    return () => {
      el.removeEventListener('dragover', handleDragOver);
      el.removeEventListener('dragenter', handleDragEnter);
      el.removeEventListener('dragleave', handleDragLeave);
      el.removeEventListener('drop', handleDrop);
    };
  }, []); // attach once; state is read via refs

  function startUpload(incoming: File[]) {
    if (incoming.length === 0 || uploadStateRef.current !== 'idle') return;
    setFiles(incoming);
    doUpload(incoming);
  }
  // Keep ref current so the native drop handler always calls the latest version
  startUploadRef.current = startUpload;

  function pickFiles() {
    if (uploadState !== 'idle' || Platform.OS !== 'web' || typeof document === 'undefined') return;
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.onchange = (e) => {
      const t = e.target as HTMLInputElement;
      if (t.files && t.files.length > 0) startUpload(Array.from(t.files));
    };
    input.click();
  }

  const [uploadError, setUploadError] = useState<string | null>(null);

  async function doUpload(filesToUpload: File[]) {
    setUploadState('uploading');
    setUploadError(null);
    let count = 0;
    const errors: string[] = [];
    for (const file of filesToUpload) {
      try {
        const formData = new FormData();
        formData.append('file', file);
        const res = await fetch(`${BACKEND_URL}/upload`, { method: 'POST', body: formData });
        if (!res.ok) {
          const body = await res.text();
          errors.push(`${file.name}: HTTP ${res.status} — ${body}`);
          console.error(`Upload failed for ${file.name}: HTTP ${res.status}`, body);
        }
      } catch (err) {
        errors.push(`${file.name}: network error — ${err}`);
        console.error(`Upload error for ${file.name}:`, err);
      }
      count++;
      setUploadedCount(count);
    }
    if (errors.length > 0) setUploadError(errors.join('\n'));
    setUploadState('done');
  }

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="dark" />
      <View style={styles.topBar}>
        <BrandLogo />
      </View>
      <ScrollView contentContainerStyle={styles.startContainer} keyboardShouldPersistTaps="handled">
        <View style={styles.uploadHero}>
          <Text style={styles.uploadHeroTitle}>Import Your Documents</Text>
          <Text style={styles.uploadHeroSubtitle}>
            Upload files to build your knowledge base
          </Text>
        </View>
        <View
          ref={dropZoneRef}
          style={[styles.dropZone, isDragging && styles.dropZoneDragging]}
        >
          <View style={styles.dropZoneBody}>
            {isIdle && (
              <>
                <View style={styles.uploadIconCircle}>
                  <Text style={styles.dropZoneIcon}>↑</Text>
                </View>
                <Text style={styles.dropZoneTitle}>Drop files here</Text>
                <Text style={styles.dropZoneOr}>or</Text>
                <Pressable onPress={pickFiles} style={styles.browseButton}>
                  <Text style={styles.browseButtonText}>Browse files</Text>
                </Pressable>
                <Text style={styles.dropZoneHint}>Accept .txt files only</Text>
              </>
            )}
            {isUploading && (
              <>
                <ActivityIndicator size="large" color="#16a34a" />
                <Text style={styles.uploadingText}>
                  Uploading… {uploadedCount} of {files.length}
                </Text>
              </>
            )}
            {isDone && (
              <>
                <Text style={styles.doneCheck}>{uploadError ? '✗' : '✓'}</Text>
                <Text style={[styles.doneText, uploadError ? { color: '#dc2626' } : null]}>
                  {uploadError
                    ? `Some files failed to upload:\n${uploadError}`
                    : 'All files uploaded successfully!'}
                </Text>
              </>
            )}
          </View>

          {(isUploading || isDone) && (
            <View style={styles.progressBarTrack}>
              <View style={[styles.progressBarFill, { width: `${progressPct}%` }]} />
            </View>
          )}

          <View style={styles.dropZoneFooter}>
            <Pressable
              onPress={onNext}
              disabled={!isDone}
              style={[styles.nextButton, !isDone && styles.nextButtonDisabled]}
            >
              <Text style={[styles.nextButtonText, !isDone && styles.nextButtonTextDisabled]}>
                Specify Topics →
              </Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

export default function App() {
  const [uploadDone, setUploadDone] = useState(false);
  const [topicInput, setTopicInput] = useState('');
  const [taggedTopics, setTaggedTopics] = useState<string[]>([]);
  const [submittedTopics, setSubmittedTopics] = useState<string[]>([]);
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [approvedRecords, setApprovedRecords] = useState<ApprovedRecord[]>([]);
  const [approvedKeys, setApprovedKeys] = useState<Set<string>>(new Set());
  const [currentReviewIndex, setCurrentReviewIndex] = useState(0);
  const [editedAnswer, setEditedAnswer] = useState('');
  const [isEditingAnswer, setIsEditingAnswer] = useState(false);
  // Maps each topic to a stable color index based on insertion order, unaffected by drag-reorder
  const [topicColorMap, setTopicColorMap] = useState<Record<string, number>>({});

  const arrowAnim = useRef(new Animated.Value(0)).current;
  const progressBarAnim = useRef(new Animated.Value(0)).current;
  const celebScale = useRef(new Animated.Value(0.6)).current;
  const celebOpacity = useRef(new Animated.Value(0)).current;
  const confettiRefs = useRef(
    FIREWORK_PARTICLES.map(() => ({
      y: new Animated.Value(0),
      x: new Animated.Value(0),
      op: new Animated.Value(0),
    }))
  ).current;
  const goldenSavedRef = useRef(false);
  const topicInputRef = useRef<TextInput>(null);
  const draggingIndexRef = useRef<number | null>(null);
  const dropTargetRef = useRef<number | null>(null);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(arrowAnim, { toValue: -5, duration: 400, useNativeDriver: true }),
        Animated.timing(arrowAnim, { toValue: 0, duration: 400, useNativeDriver: true }),
      ])
    );
    animation.start();
    return () => animation.stop();
  }, [arrowAnim]);

  // Animate progress bar fill whenever the review index advances
  useEffect(() => {
    Animated.timing(progressBarAnim, {
      toValue: currentReviewIndex + 1,
      duration: 350,
      useNativeDriver: false,
    }).start();
  }, [currentReviewIndex]);

  // Initialise the editable answer field whenever the review card changes
  useEffect(() => {
    let idx = 0;
    outer: for (const topic of submittedTopics) {
      for (const doc of documents) {
        const spans = doc.topicSpans[topic] ?? [];
        const qa = (doc.qaPairs ?? []).find((q) => spans.includes(q.span));
        if (qa) {
          if (idx === currentReviewIndex) { setEditedAnswer(qa.answer); break outer; }
          idx++;
        }
      }
    }
    setIsEditingAnswer(false);
  }, [currentReviewIndex, documents, submittedTopics]);

  // Celebration animation — re-derive "done" from state to avoid referencing reviewItems (declared after hooks)
  useEffect(() => {
    if (isLoading || !!error || documents.length === 0 || submittedTopics.length === 0) return;
    let total = 0;
    for (const topic of submittedTopics) {
      for (const doc of documents) {
        const spans = doc.topicSpans[topic] ?? [];
        const hasQA = (doc.qaPairs ?? []).some((qa) => spans.includes(qa.span));
        if (hasQA) total++;
      }
    }
    if (total === 0 || currentReviewIndex < total) return;
    celebScale.setValue(0.6);
    celebOpacity.setValue(0);
    confettiRefs.forEach((r) => { r.y.setValue(0); r.x.setValue(0); r.op.setValue(0); });
    Animated.parallel([
      Animated.spring(celebScale, { toValue: 1, friction: 5, tension: 120, useNativeDriver: true }),
      Animated.timing(celebOpacity, { toValue: 1, duration: 500, useNativeDriver: true }),
      ...confettiRefs.map((r, i) => {
        const cfg = FIREWORK_PARTICLES[i];
        return Animated.sequence([
          Animated.delay(cfg.delay),
          // Phase 1 — quick upward launch from center
          Animated.parallel([
            Animated.timing(r.op, { toValue: 1, duration: 80, useNativeDriver: true }),
            Animated.timing(r.y, { toValue: -100, duration: 280, easing: Easing.out(Easing.quad), useNativeDriver: true }),
          ]),
          // Phase 2 — burst outward to peak position
          Animated.parallel([
            Animated.timing(r.y, { toValue: cfg.ty, duration: 800, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
            Animated.timing(r.x, { toValue: cfg.tx, duration: 800, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
          ]),
          // Phase 3 — gravity drop + fade out
          Animated.parallel([
            Animated.timing(r.y, { toValue: cfg.ty + 380, duration: 650, easing: Easing.in(Easing.quad), useNativeDriver: true }),
            Animated.timing(r.op, { toValue: 0, duration: 650, useNativeDriver: true }),
          ]),
        ]);
      }),
    ]).start();
  }, [currentReviewIndex, documents, submittedTopics, isLoading, error]);

  // Save approved records to golden_dataset once all reviews are done (fires once per session)
  useEffect(() => {
    if (isLoading || !!error || documents.length === 0 || submittedTopics.length === 0) return;
    let total = 0;
    for (const topic of submittedTopics) {
      for (const doc of documents) {
        const spans = doc.topicSpans[topic] ?? [];
        const hasQA = (doc.qaPairs ?? []).some((qa) => spans.includes(qa.span));
        if (hasQA) total++;
      }
    }
    if (total === 0 || currentReviewIndex < total) return;
    if (goldenSavedRef.current || approvedRecords.length === 0) return;
    goldenSavedRef.current = true;
    fetch(`${BACKEND_URL}/save-golden`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        approvedRecords.map((r) => ({
          query: r.query,
          context: r.context,
          answer: r.answer,
          doc_id: r.docId,
        }))
      ),
    }).catch((err) => console.warn('Failed to save golden dataset:', err));
  }, [currentReviewIndex, documents, submittedTopics, isLoading, error, approvedRecords]);

  function startDrag(i: number, startX: number, startY: number) {
    let dragStarted = false;
    function handleMouseMove(ev: MouseEvent) {
      if (!dragStarted) {
        if (Math.abs(ev.clientX - startX) > 4 || Math.abs(ev.clientY - startY) > 4) {
          dragStarted = true;
          draggingIndexRef.current = i;
          setDraggingIndex(i);
          setMousePos({ x: ev.clientX, y: ev.clientY });
          (document as any).body.style.cursor = 'grabbing';
          (document as any).body.style.userSelect = 'none';
        }
      } else {
        setMousePos({ x: ev.clientX, y: ev.clientY });
      }
    }
    function handleMouseUp() {
      if (dragStarted) {
        const from = draggingIndexRef.current;
        const to = dropTargetRef.current;
        if (from !== null && to !== null && from !== to) {
          setTaggedTopics(prev => {
            const next = [...prev];
            const [moved] = next.splice(from, 1);
            next.splice(to, 0, moved);
            return next;
          });
        }
        (document as any).body.style.cursor = '';
        (document as any).body.style.userSelect = '';
      }
      draggingIndexRef.current = null;
      dropTargetRef.current = null;
      setDraggingIndex(null);
      setDragOverIndex(null);
      (window as any).removeEventListener('mousemove', handleMouseMove);
      (window as any).removeEventListener('mouseup', handleMouseUp);
    }
    (window as any).addEventListener('mousemove', handleMouseMove);
    (window as any).addEventListener('mouseup', handleMouseUp);
  }

  const canSubmit = taggedTopics.length > 0;

  function addTag() {
    const trimmed = topicInput.trim();
    if (!trimmed || taggedTopics.includes(trimmed)) {
      setTopicInput('');
      setTimeout(() => topicInputRef.current?.focus(), 0);
      return;
    }
    setTaggedTopics((prev) => [...prev, trimmed]);
    setTopicColorMap((prev) => trimmed in prev ? prev : { ...prev, [trimmed]: Object.keys(prev).length });
    setTopicInput('');
    setTimeout(() => topicInputRef.current?.focus(), 0);
  }

  function removeTag(index: number) {
    setTaggedTopics((prev) => prev.filter((_, i) => i !== index));
  }

  function submitTopic() {
    if (taggedTopics.length === 0) return;
    setSubmittedTopics(taggedTopics);
  }

  function editTopics() {
    // Open the topic editor prefilled with the most recently submitted topics
    setTaggedTopics(submittedTopics);
    setSubmittedTopics([]);
    setTopicInput('');
    setError('');
    setCurrentReviewIndex(0);
    setEditedAnswer('');
    setIsEditingAnswer(false);
    goldenSavedRef.current = false;
    setTimeout(() => topicInputRef.current?.focus(), 0);
  }

  function handleApprove(record: ApprovedRecord, key: string) {
    setApprovedKeys((prev) => new Set([...prev, key]));
    setApprovedRecords((prev) => {
      if (prev.some((r) => r.topic === record.topic && r.context === record.context)) return prev;
      return [...prev, record];
    });
    setCurrentReviewIndex((i) => i + 1);
  }

  function handleSkip() {
    setCurrentReviewIndex((i) => i + 1);
  }

  function openApprovedTable() {
    const escape = (s: string) =>
      s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const count = approvedRecords.length;
    const rows = approvedRecords
      .map((r) => {
        const palette = TOPIC_COLORS[(topicColorMap[r.topic] ?? submittedTopics.indexOf(r.topic)) % TOPIC_COLORS.length];
        const badgeStyle = `background:${palette.bg};border-color:${palette.border};color:${palette.text}`;
        return `<tr><td><span class="badge" style="${badgeStyle}">${escape(r.topic)}</span></td><td>${escape(r.query)}</td><td>${escape(r.context)}</td><td>${escape(r.answer)}</td></tr>`;
      })
      .join('');
    const tableContent =
      rows.length > 0
        ? `<table><thead><tr><th class="col-topic">Topic</th><th class="col-query">Query</th><th class="col-context">Context</th><th class="col-answer">Answer</th></tr></thead><tbody>${rows}</tbody></table>`
        : '<div class="empty">No approved records yet.</div>';
    const subtitle = `${count} approved record${count !== 1 ? 's' : ''}`;
    const html =
      '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>' +
      '<title>Golden Dataset \u00b7 GroundLens</title>' +
      '<style>' +
      '*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}' +
      'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#FFFDF7;color:#172033;min-height:100vh}' +
      '.topbar{background:#FFFDF7;border-bottom:1px solid #F0E4A0;padding:14px 32px;display:flex;align-items:center}' +
      '.brand{font-size:22px;font-weight:800;color:#172033;letter-spacing:-0.3px}' +
      '.container{max-width:1000px;margin:40px auto;padding:0 24px 60px}' +
      '.page-title{font-size:26px;font-weight:800;color:#172033;margin-bottom:6px}' +
      '.page-subtitle{font-size:15px;color:#526071;margin-bottom:28px}' +
      '.card{background:#fff;border:1px solid #e8e3c8;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(184,160,48,0.10)}' +
      'table{width:100%;border-collapse:collapse}' +
      'thead th{background:#F7F192;color:#111827;text-align:left;padding:13px 18px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;border-bottom:1.5px solid #C8A82C}' +
      '.col-topic{width:12%}.col-query{width:22%}.col-context{width:40%}.col-answer{width:26%}' +
      'td{padding:12px 18px;border-bottom:1px solid #e8e3c8;font-size:14px;color:#273244;vertical-align:top;word-break:break-word;line-height:1.6;background:#fff}' +
      'tbody tr:nth-child(even) td{background:#FFFDF7}' +
      'tbody tr:hover td{background:#FEF9C3;transition:background 0.12s}' +
      'tbody tr:last-child td{border-bottom:none}' +
      '.badge{display:inline-block;background:#FEF9C3;border:1px solid #EAB308;color:#78350F;border-radius:12px;padding:3px 10px;font-size:12px;font-weight:600;white-space:nowrap}' +
      '.empty{text-align:center;padding:56px 24px;color:#526071;font-size:15px}' +
      '.btn-row{display:flex;justify-content:flex-end;margin-top:16px}' +
      '.dl-btn{background:#F7F192;border:1px solid #C8A82C;border-radius:8px;color:#111827;cursor:pointer;font-size:15px;font-weight:700;padding:10px 22px}' +
      '.dl-btn:hover{background:#f0e87a}' +
      '</style></head>' +
      `<body><div class="topbar"><span class="brand">GroundLens</span></div><div class="container"><div class="page-title">Golden Dataset</div><div class="page-subtitle">${subtitle}</div><div class="card">${tableContent}</div><div class="btn-row"><button class="dl-btn" onclick="downloadCSV()">Download \u2193</button></div></div><script>function downloadCSV(){var rows=[["Topic","Query","Context","Answer"]];var trs=document.querySelectorAll("tbody tr");trs.forEach(function(tr){var tds=tr.querySelectorAll("td");var row=[];tds.forEach(function(td){row.push(\'"\'+td.innerText.replace(/"/g,\'""\')+\'"\')});rows.push(row)});var csv=rows.map(function(r){return r.join(",")}).join("\\n");var a=document.createElement("a");a.href="data:text/csv;charset=utf-8,"+encodeURIComponent(csv);a.download="golden_dataset.csv";a.click()}<\/script></body></html>`;
    if (typeof window !== 'undefined') {
      const win = window.open('', '_blank');
      if (win) {
        win.document.write(html);
        win.document.close();
      }
    }
  }

  useEffect(() => {
    if (submittedTopics.length === 0) {
      setDocuments([]);
      setError('');
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError('');

    const params = submittedTopics
      .map((t) => `topic=${encodeURIComponent(t)}`)
      .join('&');

    fetch(`${BACKEND_URL}/documents?${params}`)
      .then((response) => {
        if (!response.ok) throw new Error('Could not load the knowledge base.');
        return response.json() as Promise<BatchDocumentsResponse>;
      })
      .then((data) => setDocuments(data.documents))
      .catch(() => {
        setDocuments([]);
        setError('Could not reach the backend at http://localhost:8000. Start FastAPI and try again.');
      })
      .finally(() => setIsLoading(false));
  }, [submittedTopics]);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const timer = setTimeout(() => {
      if (typeof document !== 'undefined') {
        const el = document.getElementById('qa-highlight-active') as HTMLElement | null;
        el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 120);
    return () => clearTimeout(timer);
  }, [currentReviewIndex, documents]);

  if (!uploadDone) {
    return <UploadPage onNext={() => setUploadDone(true)} />;
  }

  if (submittedTopics.length === 0) {
    return (
      <SafeAreaView style={styles.screen}>
        <StatusBar style="dark" />
        <View style={styles.topBar}>
          <BrandLogo />
        </View>
        <ScrollView contentContainerStyle={styles.startContainer} keyboardShouldPersistTaps="handled">
          <View style={styles.uploadHero}>
            <Text style={styles.uploadHeroTitle}>Specify Your Topics</Text>
            <Text style={styles.uploadHeroSubtitle}>
              Type a topic and press Enter or + to add it
            </Text>
          </View>
          <View style={styles.tagInputCard}>
            <View style={styles.tagInputRow}>
              <TextInput
                ref={topicInputRef}
                autoCapitalize="none"
                autoCorrect={false}
                blurOnSubmit={false}
                onChangeText={setTopicInput}
                onSubmitEditing={addTag}
                placeholder="e.g. Facebook campaigns"
                placeholderTextColor="#78818f"
                returnKeyType="done"
                style={styles.tagTextInput}
                value={topicInput}
              />
              <Pressable onPress={addTag} style={styles.tagAddButton}>
                <Text style={styles.tagAddButtonText}>+</Text>
              </Pressable>
            </View>
            {taggedTopics.length > 0 && (
              <View style={styles.tagList}>
                <View style={styles.prioritiesHeader}>
                  <Text style={styles.prioritiesTitle}>Priorities</Text>
                  <Text style={styles.dragHint}>drag to reorder</Text>
                </View>
                {taggedTopics.map((tag, i) => {
                  const palette = TOPIC_COLORS[(topicColorMap[tag] ?? i) % TOPIC_COLORS.length];
                  const isDragging = draggingIndex === i;
                  const isDragOver = dragOverIndex === i && draggingIndex !== i;
                  return (
                    <View
                      key={`${tag}-${i}`}
                      style={[styles.tagRow, isDragging && styles.tagRowDragging, isDragOver && styles.tagRowDragOver]}
                      // @ts-ignore
                      onMouseDown={(e: any) => {
                        const x = e.clientX ?? e.nativeEvent?.clientX ?? 0;
                        const y = e.clientY ?? e.nativeEvent?.clientY ?? 0;
                        startDrag(i, x, y);
                      }}
                      // @ts-ignore
                      onMouseEnter={() => {
                        if (draggingIndexRef.current !== null) {
                          setDragOverIndex(i);
                          dropTargetRef.current = i;
                        }
                      }}
                      // @ts-ignore
                      onMouseLeave={() => {
                        if (dropTargetRef.current === i) {
                          setDragOverIndex(null);
                          dropTargetRef.current = null;
                        }
                      }}
                    >
                      <Text style={styles.dragHandleText}>⠿</Text>
                      <Text style={styles.tagRowNumber}>{i + 1}</Text>
                      <View style={[styles.tagChip, { backgroundColor: palette.bg, borderColor: palette.border, flex: 1 }]}>
                        <Text style={[styles.tagChipText, { color: palette.text, flex: 1 }]}>{tag}</Text>
                        <Pressable onPress={() => removeTag(i)} style={styles.tagRemoveBtn}>
                          <Text style={[styles.tagRemoveBtnText, { color: palette.text }]}>×</Text>
                        </Pressable>
                      </View>
                    </View>
                  );
                })}
              </View>
            )}
          </View>
          <View style={styles.actionRow}>
            <Pressable
              disabled={!canSubmit}
              onPress={submitTopic}
              style={[styles.submitButton, !canSubmit && styles.submitButtonDisabled]}
            >
              <Text style={[styles.submitButtonText, !canSubmit && { color: '#e5e7eb' }]}>Submit →</Text>
            </Pressable>
          </View>
        </ScrollView>
        {draggingIndex !== null && taggedTopics[draggingIndex] !== undefined && (
          <View
            pointerEvents="none"
            style={[styles.dragGhost, { left: mousePos.x + 14, top: mousePos.y - 14 }]}
          >
            <Text style={styles.dragHandleText}>⠿</Text>
            <Text style={styles.tagRowNumber}>{draggingIndex + 1}</Text>
            <View style={[
              styles.tagChip,
              {
                backgroundColor: TOPIC_COLORS[(topicColorMap[taggedTopics[draggingIndex]] ?? draggingIndex) % TOPIC_COLORS.length].bg,
                borderColor: TOPIC_COLORS[(topicColorMap[taggedTopics[draggingIndex]] ?? draggingIndex) % TOPIC_COLORS.length].border,
              }
            ]}>
              <Text style={[styles.tagChipText, { color: TOPIC_COLORS[(topicColorMap[taggedTopics[draggingIndex]] ?? draggingIndex) % TOPIC_COLORS.length].text }]}>
                {taggedTopics[draggingIndex]}
              </Text>
            </View>
          </View>
        )}
      </SafeAreaView>
    );
  }

  // Build flat review queue ordered by topic priority
  const reviewItems: ReviewItem[] = [];
  if (documents.length > 0) {
    for (let ti = 0; ti < submittedTopics.length; ti++) {
      const topic = submittedTopics[ti];
      for (const doc of documents) {
        const spans = doc.topicSpans[topic] ?? [];
        const qa = (doc.qaPairs ?? []).find((qa) => spans.includes(qa.span));
        if (qa) {
          reviewItems.push({
            topic,
            topicIndex: ti,
            doc,
            qaPair: qa,
            palette: TOPIC_COLORS[(topicColorMap[topic] ?? ti) % TOPIC_COLORS.length],
          });
        }
      }
    }
  }

  const currentItem = reviewItems[currentReviewIndex] ?? null;
  const allReviewDone =
    !isLoading && !error && documents.length > 0 &&
    reviewItems.length > 0 && currentReviewIndex >= reviewItems.length;
  const noQAPairs = !isLoading && !error && documents.length > 0 && reviewItems.length === 0;
  const currentTopicIndex = currentItem?.topicIndex ?? (allReviewDone ? submittedTopics.length : 0);

  // Combine title + body into one list so a span in the title also gets a Q&A card
  const allBlocks: ContentBlock[] = currentItem ? [
    { kind: 'heading' as const, text: currentItem.doc.title },
    ...formatContent(getDocumentBody(currentItem.doc.content)),
  ] : [];
  // Only the FIRST block containing the span shows the Q&A card
  const activeBlockIndex = currentItem
    ? allBlocks.findIndex((b) => b.text.includes(currentItem.qaPair.span))
    : -1;

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="dark" />

      {/* Review header: logo + edit button + topic progress */}
      <View style={styles.reviewHeader}>
        <View style={styles.reviewHeaderTop}>
          <BrandLogo />
          <Pressable accessibilityLabel="Edit topics" onPress={editTopics} style={styles.editTopicsButton}>
            <Animated.Text style={[styles.editTopicsArrow, { transform: [{ translateX: arrowAnim }] }]}>←</Animated.Text>
            <Text style={styles.editTopicsButtonText}>Edit Topics</Text>
          </Pressable>
        </View>
        <View style={styles.topicProgressRow}>
          {submittedTopics.map((topic, i) => {
            const palette = TOPIC_COLORS[(topicColorMap[topic] ?? i) % TOPIC_COLORS.length];
            const isCompleted = allReviewDone || i < currentTopicIndex;
            const isActive = !allReviewDone && i === currentTopicIndex;
            const isUpcoming = !allReviewDone && i > currentTopicIndex;
            return (
              <View
                key={`prog-${i}`}
                style={[
                  styles.progressTag,
                  isUpcoming
                    ? styles.progressTagGray
                    : { backgroundColor: palette.bg, borderColor: palette.border },
                  isActive && styles.progressTagActive,
                ]}
              >
                {isCompleted && (
                  <Text style={[styles.progressTagIcon, { color: palette.text }]}>✓ </Text>
                )}
                {isActive && (
                  <Text style={[styles.progressTagIcon, { color: palette.text }]}>● </Text>
                )}
                <Text
                  style={[
                    styles.progressTagText,
                    isUpcoming ? styles.progressTagTextGray : { color: palette.text },
                  ]}
                >
                  {topic}
                </Text>
              </View>
            );
          })}
        </View>
        {/* Progress bar — shown while reviewing */}
        {!isLoading && !allReviewDone && reviewItems.length > 0 && currentItem && (
          <View style={styles.reviewProgressBarRow}>
            <View style={styles.reviewProgressBarTrack}>
              <Animated.View
                style={[
                  styles.reviewProgressBarFill,
                  {
                    width: progressBarAnim.interpolate({
                      inputRange: [0, reviewItems.length],
                      outputRange: ['0%', '100%'],
                      extrapolate: 'clamp',
                    }),
                  },
                ]}
              />
            </View>
            <Text style={styles.reviewProgressBarLabel}>
              {currentReviewIndex + 1} / {reviewItems.length}
            </Text>
          </View>
        )}
      </View>

      {/* Body */}
      {isLoading ? (
        <View style={styles.centerState}>
          <ActivityIndicator color="#B8960C" />
          <Text style={styles.stateText}>Finding matching documents...</Text>
        </View>
      ) : error ? (
        <View style={[styles.notice, { margin: 20 }]}>
          <Text style={styles.noticeTitle}>Connection issue</Text>
          <Text style={styles.noticeText}>{error}</Text>
        </View>
      ) : documents.length === 0 ? (
        <View style={[styles.notice, { margin: 20 }]}>
          <Text style={styles.noticeTitle}>No matching document</Text>
          <Text style={styles.noticeText}>Try other topics from the knowledge base.</Text>
        </View>
      ) : noQAPairs ? (
        <View style={[styles.notice, { margin: 20 }]}>
          <Text style={styles.noticeTitle}>No Q&A pairs found</Text>
          <Text style={styles.noticeText}>Documents matched but no Q&A could be generated. Try different topics.</Text>
        </View>
      ) : allReviewDone ? (
        <View style={styles.completionScreen}>
          {/* Fireworks burst particles */}
          {FIREWORK_PARTICLES.map((cfg, i) => (
            <Animated.Text
              key={`fw-${i}`}
              style={[
                styles.confettiEmoji,
                {
                  opacity: confettiRefs[i].op,
                  transform: [
                    { translateY: confettiRefs[i].y },
                    { translateX: confettiRefs[i].x },
                  ],
                },
              ]}
            >
              {cfg.emoji}
            </Animated.Text>
          ))}
          <Animated.Text style={[styles.completionTitle, { transform: [{ scale: celebScale }], opacity: celebOpacity }]}>
            All Done!
          </Animated.Text>
          <Animated.Text style={[styles.completionSubtitle, { opacity: celebOpacity }]}>
            {approvedRecords.length} Q&A pair{approvedRecords.length !== 1 ? 's' : ''} approved
          </Animated.Text>
          <Animated.View style={{ opacity: celebOpacity }}>
            <Pressable
              onPress={openApprovedTable}
              disabled={approvedRecords.length === 0}
              style={[styles.confirmButton, approvedRecords.length === 0 && styles.confirmButtonDisabled]}
            >
              <Text style={styles.confirmButtonText}>View Dataset →</Text>
            </Pressable>
          </Animated.View>
        </View>
      ) : currentItem ? (
        <ScrollView style={styles.reviewScroll} contentContainerStyle={styles.reviewScrollContent}>
          {allBlocks.map((block, index) => {
            const isActiveBlock = index === activeBlockIndex;
            const textStyle = index === 0
              ? styles.documentTitle
              : block.kind === 'heading' ? styles.sectionHeading : styles.paragraph;
            const activeTopics = [{
              text: currentItem.topic,
              color: currentItem.palette.bg,
              palette: currentItem.palette,
              spans: [currentItem.qaPair.span],
            }];

            if (!isActiveBlock) {
              return (
                <Text key={`rb-${index}`} style={textStyle}>
                  <HighlightedText text={block.text} topics={activeTopics} />
                </Text>
              );
            }

            return (
              <View key={`rb-${index}`} nativeID="qa-highlight-active" style={styles.inlineQARow}>
                <View style={styles.inlineQAText}>
                  <Text style={[textStyle, { marginBottom: 0, marginTop: 0 }]}>
                    <HighlightedText text={block.text} topics={activeTopics} />
                  </Text>
                </View>
                <View style={[styles.inlineQADash, { borderColor: currentItem.palette.border }]} />
                <View style={[styles.inlineQACard, { backgroundColor: currentItem.palette.bg, borderColor: currentItem.palette.border }]}>
                  <View style={[styles.qaReviewTopicBadge, { borderColor: currentItem.palette.border }]}>
                    <Text style={[styles.qaReviewTopicText, { color: currentItem.palette.text }]}>
                      {currentItem.topic}
                    </Text>
                  </View>
                  <Text style={[styles.qaReviewQuestion, { color: currentItem.palette.text }]}>
                    <Text style={{ fontWeight: 'bold' }}>Q: </Text>
                    {currentItem.qaPair.question}
                  </Text>
                  <View style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: 8 }}>
                    <Text style={[styles.qaReviewAnswer, { marginRight: 8 }]}>A:</Text>
                    {isEditingAnswer ? (
                      <TextInput
                        style={[styles.answerEditInput, { flex: 1 }]}
                        value={editedAnswer}
                        onChangeText={setEditedAnswer}
                        multiline
                        scrollEnabled={false}
                        autoFocus
                      />
                    ) : (
                      <View style={{ flex: 1, flexDirection: 'row', alignItems: 'flex-start' }}>
                        <Text style={[styles.answerDisplayText, { marginBottom: 0, flex: 1 }]}>{editedAnswer}</Text>
                        <Pressable onPress={() => setIsEditingAnswer(true)} style={[styles.editAnswerButton, { marginLeft: 8, alignSelf: 'flex-start' }]}> 
                          <Text style={styles.editAnswerButtonText}>Edit</Text>
                        </Pressable>
                      </View>
                    )}
                  </View>
                  <View style={styles.qaReviewButtons}>
                    <Pressable onPress={handleSkip} style={styles.skipButton}>
                      <Text style={styles.skipButtonText}>Skip</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => {
                        const finalAnswer = editedAnswer.trim() || currentItem.qaPair.answer;
                        handleApprove(
                          {
                            topic: currentItem.topic,
                            query: currentItem.qaPair.question,
                            context: currentItem.qaPair.span,
                            answer: finalAnswer,
                            docId: currentItem.doc.id,
                          },
                          `${currentItem.doc.id}-${currentItem.qaPair.span}`
                        );
                        if (editedAnswer.trim() && editedAnswer.trim() !== currentItem.qaPair.answer) {
                          fetch(`${BACKEND_URL}/update-answer`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              doc_id: currentItem.doc.id,
                              span: currentItem.qaPair.span,
                              question: currentItem.qaPair.question,
                              user_answer: editedAnswer.trim(),
                            }),
                          }).catch((err) => console.warn('Failed to update answer:', err));
                        }
                      }}
                      style={[styles.qaApproveButton, { backgroundColor: currentItem.palette.border }]}
                    >
                      <Text style={styles.qaApproveButtonText}>Approve</Text>
                    </Pressable>
                  </View>
                </View>
              </View>
            );
          })}
        </ScrollView>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#FFFDF7',
  },
  startContainer: {
    alignItems: 'center',
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 40,
  },
  topBar: {
    alignItems: 'flex-start',
    borderBottomColor: '#F0E4A0',
    borderBottomWidth: 1,
    paddingBottom: 14,
    paddingHorizontal: 20,
    paddingTop: 14,
  },
  brandRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    marginBottom: 14,
  },
  logo: {
    borderRadius: 7,
    height: 32,
    width: 32,
  },
  brand: {
    color: '#172033',
    fontSize: 28,
    fontWeight: '800',
  },
  tagInputCard: {
    alignSelf: 'center',
    backgroundColor: '#ffffff',
    borderColor: '#E8D87A',
    borderRadius: 14,
    borderWidth: 1,
    maxWidth: 520,
    padding: 20,
    shadowColor: '#C8A82C',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 2,
    width: '100%',
    marginBottom: 16,
  },
  tagInputRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  tagTextInput: {
    backgroundColor: '#FFFDF7',
    borderColor: '#D4C66A',
    borderRadius: 8,
    borderWidth: 1,
    color: '#172033',
    flex: 1,
    fontSize: 16,
    minHeight: 48,
    paddingHorizontal: 14,
  },
  tagAddButton: {
    alignItems: 'center',
    backgroundColor: '#F7F192',
    borderColor: '#C8A82C',
    borderRadius: 8,
    borderWidth: 1,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  tagAddButtonText: {
    color: '#7A4500',
    fontSize: 26,
    fontWeight: '700',
    lineHeight: 30,
  },
  tagList: {
    flexDirection: 'column',
    gap: 4,
    marginTop: 16,
  },
  prioritiesHeader: {
    alignItems: 'baseline',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  prioritiesTitle: {
    color: '#172033',
    fontSize: 14,
    fontWeight: '700',
  },
  dragHint: {
    color: '#78818f',
    fontSize: 12,
    fontStyle: 'italic',
  },
  tagRow: {
    alignItems: 'center',
    borderRadius: 8,
    cursor: 'grab',
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 4,
    paddingVertical: 4,
  } as any,
  tagRowDragging: {
    opacity: 0.2,
  },
  tagRowDragOver: {
    backgroundColor: '#FEF9C3',
  },
  dragHandleText: {
    color: '#b0bac3',
    fontSize: 18,
    userSelect: 'none',
  } as any,
  dragGhost: {
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderRadius: 10,
    boxShadow: '0 8px 24px rgba(0,0,0,0.22)',
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    position: 'fixed',
    transform: [{ rotate: '2deg' }],
    zIndex: 9999,
  } as any,
  tagRowNumber: {
    color: '#526071',
    fontSize: 14,
    fontWeight: '700',
    minWidth: 20,
    textAlign: 'right',
  },
  tagChip: {
    alignItems: 'center',
    borderRadius: 20,
    borderWidth: 1.5,
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  tagChipText: {
    fontSize: 14,
    fontWeight: '600',
  },
  tagRemoveBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 2,
  },
  tagRemoveBtnText: {
    fontSize: 18,
    fontWeight: '700',
    lineHeight: 20,
  },
  actionRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'center',
    marginTop: 2,
    maxWidth: 520,
    width: '100%',
  },
  submitButton: {
    alignItems: 'center',
    backgroundColor: '#F7F192',
    borderColor: '#C8A82C',
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 42,
    paddingHorizontal: 22,
  },
  submitButtonDisabled: {
    backgroundColor: '#aeb8c6',
  },
  submitButtonText: {
    color: '#111827',
    fontSize: 16,
    fontWeight: '700',
  },
  editTopicsButton: {
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderColor: '#b7c1cf',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
    minHeight: 38,
    paddingHorizontal: 14,
  },
  editTopicsArrow: {
    color: '#172033',
    fontSize: 15,
    fontWeight: '700',
  },
  editTopicsButtonText: {
    color: '#172033',
    fontSize: 15,
    fontWeight: '700',
  },
  centerState: {
    alignItems: 'center',
    gap: 12,
    paddingTop: 64,
  },
  stateText: {
    color: '#526071',
    fontSize: 15,
  },
  notice: {
    backgroundColor: '#ffffff',
    borderColor: '#e8e3c8',
    borderRadius: 10,
    borderWidth: 1,
    padding: 18,
  },
  noticeTitle: {
    color: '#172033',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 6,
  },
  noticeText: {
    color: '#526071',
    fontSize: 15,
    lineHeight: 22,
  },
  document: {
    backgroundColor: '#ffffff',
    borderColor: '#e8e3c8',
    borderRadius: 10,
    borderWidth: 1,
    elevation: 2,
    padding: 20,
    shadowColor: '#B8A030',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
  },
  documentTitle: {
    color: '#111827',
    fontSize: 24,
    fontWeight: '400',
    lineHeight: 32,
    marginBottom: 18,
  },
  sectionHeading: {
    color: '#1f3763',
    fontSize: 18,
    fontWeight: '400',
    lineHeight: 26,
    marginBottom: 10,
    marginTop: 8,
  },
  paragraph: {
    color: '#273244',
    fontSize: 16,
    lineHeight: 25,
    marginBottom: 16,
  },
  qaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    gap: 0,
  },
  qaRowText: {
    flex: 3,
  },
  qaDash: {
    width: 16,
    borderTopWidth: 1.5,
    borderStyle: 'dashed',
    alignSelf: 'center',
  },
  qaCard: {
    flex: 2,
    borderRadius: 8,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    padding: 10,
  },
  qaQuestion: {
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 17,
    marginBottom: 4,
  },
  qaAnswer: {
    color: '#374151',
    fontSize: 12,
    lineHeight: 17,
  },
  approveButton: {
    alignSelf: 'flex-end',
    backgroundColor: '#F7F192',
    borderColor: '#C8A82C',
    borderRadius: 6,
    borderWidth: 1,
    marginTop: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  approveButtonApproved: {
    alignSelf: 'flex-end',
    backgroundColor: '#d1fae5',
    borderRadius: 6,
    marginTop: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  approveButtonText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '700',
  },
  approveButtonApprovedText: {
    color: '#065f46',
    fontSize: 11,
    fontWeight: '700',
  },
  confirmFooter: {
    alignItems: 'flex-end',
    backgroundColor: '#FFFDF7',
    borderTopColor: '#F0E4A0',
    borderTopWidth: 1,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  confirmButton: {
    backgroundColor: '#F7F192',
    borderColor: '#C8A82C',
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 22,
    paddingVertical: 10,
  },
  confirmButtonDisabled: {
    backgroundColor: '#aeb8c6',
  },
  confirmButtonText: {
    color: '#111827',
    fontSize: 15,
    fontWeight: '700',
  },
  // ── Upload page ──────────────────────────────────────────────
  dropZone: {
    alignSelf: 'center',
    backgroundColor: '#ffffff',
    borderColor: '#E8D87A',
    borderRadius: 14,
    borderStyle: 'dashed',
    borderWidth: 2,
    elevation: 3,
    maxWidth: 560,
    minHeight: 240,
    padding: 28,
    shadowColor: '#C8A82C',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.10,
    shadowRadius: 12,
    width: '100%',
  },
  dropZoneDragging: {
    backgroundColor: 'rgba(212, 160, 23, 0.06)',
    borderColor: '#D4A017',
  },
  dropZoneBody: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    paddingVertical: 24,
  },
  dropZoneIcon: {
    color: '#8B6914',
    fontSize: 28,
    fontWeight: '800',
  },
  dropZoneTitle: {
    color: '#172033',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 8,
    marginTop: 4,
  },
  dropZoneOr: {
    color: '#78818f',
    fontSize: 14,
    marginBottom: 12,
  },
  browseButton: {
    alignItems: 'center',
    backgroundColor: '#F7F192',
    borderColor: '#C8A82C',
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 22,
    paddingVertical: 10,
  },
  browseButtonText: {
    color: '#111827',
    fontSize: 15,
    fontWeight: '700',
  },
  uploadingText: {
    color: '#526071',
    fontSize: 15,
    marginTop: 14,
  },
  doneCheck: {
    color: '#16a34a',
    fontSize: 48,
    fontWeight: '800',
  },
  doneText: {
    color: '#16a34a',
    fontSize: 16,
    fontWeight: '600',
    marginTop: 8,
  },
  progressBarTrack: {
    backgroundColor: '#d1fae5',
    borderRadius: 5,
    height: 10,
    marginTop: 20,
    overflow: 'hidden',
    width: '100%',
  },
  progressBarFill: {
    backgroundColor: '#16a34a',
    borderRadius: 5,
    height: 10,
  },
  dropZoneFooter: {
    alignItems: 'flex-end',
    marginTop: 16,
  },
  nextButton: {
    alignItems: 'center',
    backgroundColor: '#F7F192',
    borderColor: '#C8A82C',
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 22,
    paddingVertical: 10,
  },
  nextButtonDisabled: {
    backgroundColor: '#aeb8c6',
  },
  nextButtonText: {
    color: '#111827',
    fontSize: 15,
    fontWeight: '700',
  },
  nextButtonTextDisabled: {
    color: '#e5e7eb',
  },
  uploadHero: {
    alignItems: 'center',
    marginBottom: 28,
    maxWidth: 560,
    width: '100%',
  },
  uploadHeroTitle: {
    color: '#172033',
    fontSize: 26,
    fontWeight: '800',
    marginBottom: 8,
    textAlign: 'center',
  },
  uploadHeroSubtitle: {
    color: '#526071',
    fontSize: 16,
    lineHeight: 24,
    textAlign: 'center',
  },
  uploadIconCircle: {
    alignItems: 'center',
    backgroundColor: 'rgba(247, 241, 146, 0.40)',
    borderColor: '#E8D87A',
    borderRadius: 40,
    borderWidth: 2,
    height: 80,
    justifyContent: 'center',
    marginBottom: 16,
    width: 80,
  },
  dropZoneHint: {
    color: '#78818f',
    fontSize: 12,
    marginTop: 10,
  },
  // ── Review page ──────────────────────────────────────────────
  reviewHeader: {
    backgroundColor: '#FFFDF7',
    borderBottomColor: '#F0E4A0',
    borderBottomWidth: 1,
    paddingHorizontal: 20,
    paddingBottom: 14,
    paddingTop: 14,
  },
  reviewHeaderTop: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  topicProgressRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  progressTag: {
    alignItems: 'center',
    borderRadius: 20,
    borderWidth: 1.5,
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  progressTagGray: {
    backgroundColor: '#f1f3f5',
    borderColor: '#ced4da',
  },
  progressTagActive: {
    borderWidth: 2,
  },
  progressTagIcon: {
    fontSize: 11,
    fontWeight: '700',
  },
  progressTagText: {
    fontSize: 13,
    fontWeight: '600',
  },
  progressTagTextGray: {
    color: '#868e96',
  },
  reviewScroll: {
    flex: 1,
  },
  reviewScrollContent: {
    paddingHorizontal: 28,
    paddingBottom: 60,
    paddingTop: 24,
  },
  inlineQARow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    marginBottom: 16,
  },
  inlineQAText: {
    flex: 3,
  },
  inlineQADash: {
    alignSelf: 'center',
    borderStyle: 'dashed',
    borderTopWidth: 1.5,
    marginHorizontal: 6,
    width: 18,
  },
  inlineQACard: {
    borderRadius: 10,
    borderStyle: 'dashed',
    borderWidth: 1.5,
    flex: 2,
    padding: 12,
  },
  qaReviewTopicBadge: {
    alignSelf: 'flex-start',
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 14,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  qaReviewTopicText: {
    fontSize: 12,
    fontWeight: '700',
  },
  qaReviewQuestion: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 10,
  },
  qaReviewAnswer: {
    color: '#374151',
    fontSize: 13,
    fontWeight: 'bold',
    lineHeight: 19,
  },
  editAnswerButton: {
    alignSelf: 'flex-end',
    backgroundColor: '#EBEAE6',
    borderRadius: 4,
    marginBottom: 14,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  editAnswerButtonText: {
    color: '#374151',
    fontSize: 12,
    fontWeight: '600',
  },
  answerDisplayText: {
    color: '#374151',
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 14,
  },
  answerEditInput: {
    backgroundColor: '#ffffff',
    borderColor: '#d1d5db',
    borderRadius: 6,
    borderWidth: 1,
    color: '#374151',
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 8,
    minHeight: 60,
    padding: 8,
  },
  qaReviewButtons: {
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'flex-end',
  },
  skipButton: {
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderColor: '#ced4da',
    borderRadius: 6,
    borderWidth: 1,
    justifyContent: 'center',
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  skipButtonText: {
    color: '#526071',
    fontSize: 13,
    fontWeight: '600',
  },
  qaApproveButton: {
    alignItems: 'center',
    borderRadius: 6,
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 7,
  },
  qaApproveButtonText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
  completionScreen: {
    alignItems: 'center',
    flex: 1,
    gap: 16,
    justifyContent: 'center',
    padding: 40,
  },
  completionTitle: {
    color: '#172033',
    fontSize: 32,
    fontWeight: '800',
  },
  completionSubtitle: {
    color: '#526071',
    fontSize: 16,
    marginBottom: 8,
  },
  reviewProgressBarRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    paddingBottom: 10,
    paddingHorizontal: 16,
    paddingTop: 6,
  },
  reviewProgressBarTrack: {
    backgroundColor: '#E8ECF0',
    borderRadius: 4,
    flex: 1,
    height: 6,
    overflow: 'hidden',
  },
  reviewProgressBarFill: {
    backgroundColor: '#C8A82C',
    borderRadius: 4,
    height: 6,
  },
  reviewProgressBarLabel: {
    color: '#526071',
    fontSize: 12,
    fontWeight: '700',
    minWidth: 36,
    textAlign: 'right',
  },
  confettiEmoji: {
    fontSize: 36,
    position: 'absolute',
  },
});
