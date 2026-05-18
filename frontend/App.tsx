import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  ActivityIndicator,
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
};

type KnowledgeDocument = {
  id: string;
  title: string;
  content: string;
  topicSpans: Record<string, string[]>;
  qaPairs: QAPair[];
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

function splitStepSection(section: string): ContentBlock[] {
  const starterPattern = stepBodyStarters.join('|');
  const match = section.match(new RegExp(`^((Step \\d+ \\| .*?))(${starterPattern})\\b(.*)$`));

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

function DocumentCard({
  doc,
  matchedTopics,
  approvedKeys,
  onApprove,
}: {
  doc: KnowledgeDocument;
  matchedTopics: ColoredTopic[];
  approvedKeys: Set<string>;
  onApprove: (record: ApprovedRecord, key: string) => void;
}) {
  const bodyBlocks = formatContent(getDocumentBody(doc.content));
  const qaPairs = doc.qaPairs ?? [];

  // Map each span to its topic's color palette
  const spanToPalette: Record<string, { bg: string; border: string; text: string }> = {};
  for (const { palette, spans } of matchedTopics) {
    for (const span of spans) spanToPalette[span] = palette;
  }

  return (
    <View style={styles.document}>
      <Text style={styles.documentTitle}>
        <HighlightedText text={doc.title} topics={matchedTopics} />
      </Text>
      {bodyBlocks.map((block, index) => {
        const matchingQA = qaPairs.find((qa) => block.text.includes(qa.span));
        const palette = matchingQA ? (spanToPalette[matchingQA.span] ?? null) : null;

        if (!matchingQA || !palette) {
          return (
            <Text
              key={`${doc.id}-b${index}`}
              style={block.kind === 'heading' ? styles.sectionHeading : styles.paragraph}
            >
              <HighlightedText text={block.text} topics={matchedTopics} />
            </Text>
          );
        }

        const qaKey = `${doc.id}-${matchingQA.span}`;
        const approved = approvedKeys.has(qaKey);
        const qaQuery = matchedTopics.find((t) => t.spans.includes(matchingQA.span))?.text ?? '';

        return (
          <View key={`${doc.id}-b${index}`} style={styles.qaRow}>
            <View style={styles.qaRowText}>
              <Text style={[block.kind === 'heading' ? styles.sectionHeading : styles.paragraph, { marginBottom: 0, marginTop: 0 }]}>
                <HighlightedText text={block.text} topics={matchedTopics} />
              </Text>
            </View>
            <View style={[styles.qaDash, { borderColor: palette.border }]} />
            <View style={[styles.qaCard, { backgroundColor: palette.bg, borderColor: palette.border }]}>
              <Text style={[styles.qaQuestion, { color: palette.text }]}>
                <Text style={{ fontWeight: 'bold' }}>Q:</Text>{' '}
                {matchingQA.question}
              </Text>
              <Text style={styles.qaAnswer}>
                <Text style={{ fontWeight: 'bold' }}>A:</Text>{' '}
                {matchingQA.answer}
              </Text>
              <Pressable
                onPress={() =>
                  onApprove(
                    { topic: qaQuery, query: matchingQA.question, context: matchingQA.span, answer: matchingQA.answer },
                    qaKey
                  )
                }
                disabled={approved}
                style={approved ? styles.approveButtonApproved : [styles.approveButton, { backgroundColor: palette.border }]}
              >
                <Text style={approved ? styles.approveButtonApprovedText : [styles.approveButtonText, { color: palette.text }]}>
                  {approved ? '✓ Approved' : 'Approve'}
                </Text>
              </Pressable>
            </View>
          </View>
        );
      })}
    </View>
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

  const arrowAnim = useRef(new Animated.Value(0)).current;
  const topicInputRef = useRef<TextInput>(null);

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

  const canSubmit = taggedTopics.length > 0;

  function addTag() {
    const trimmed = topicInput.trim();
    if (!trimmed || taggedTopics.includes(trimmed)) {
      setTopicInput('');
      setTimeout(() => topicInputRef.current?.focus(), 0);
      return;
    }
    setTaggedTopics((prev) => [...prev, trimmed]);
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
    setSubmittedTopics([]);
    setTaggedTopics([]);
    setTopicInput('');
    setDocuments([]);
    setError('');
  }

  function handleApprove(record: ApprovedRecord, key: string) {
    setApprovedKeys((prev) => new Set([...prev, key]));
    setApprovedRecords((prev) => {
      if (prev.some((r) => r.topic === record.topic && r.context === record.context)) return prev;
      return [...prev, record];
    });
  }

  function openApprovedTable() {
    const escape = (s: string) =>
      s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const count = approvedRecords.length;
    const rows = approvedRecords
      .map((r) => {
        const topicIdx = submittedTopics.indexOf(r.topic);
        const palette = TOPIC_COLORS[(topicIdx >= 0 ? topicIdx : 0) % TOPIC_COLORS.length];
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
      '</style></head>' +
      `<body><div class="topbar"><span class="brand">GroundLens</span></div><div class="container"><div class="page-title">Golden Dataset</div><div class="page-subtitle">${subtitle}</div><div class="card">${tableContent}</div></div></body></html>`;
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
              Type a topic and press Enter or + to add it as a tag
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
                {taggedTopics.map((tag, i) => {
                  const palette = TOPIC_COLORS[i % TOPIC_COLORS.length];
                  return (
                    <View
                      key={`${tag}-${i}`}
                      style={[styles.tagChip, { backgroundColor: palette.bg, borderColor: palette.border }]}
                    >
                      <Text style={[styles.tagChipText, { color: palette.text }]}>{tag}</Text>
                      <Pressable onPress={() => removeTag(i)} style={styles.tagRemoveBtn}>
                        <Text style={[styles.tagRemoveBtnText, { color: palette.text }]}>×</Text>
                      </Pressable>
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
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <BrandLogo />
        <View style={styles.selectedTopicsRow}>
          <Text style={styles.selectedTopicLabel}>Selected topics</Text>
          <View style={styles.selectedTopicsChips}>
            {submittedTopics.map((topic, i) => {
              const palette = TOPIC_COLORS[i % TOPIC_COLORS.length];
              return (
                <View
                  key={topic}
                  style={[styles.topicChip, { backgroundColor: palette.bg, borderColor: palette.border }]}
                >
                  <Text style={[styles.topicChipText, { color: palette.text }]}>{topic}</Text>
                </View>
              );
            })}
            <Pressable accessibilityLabel="Edit topics" onPress={editTopics} style={styles.editTopicsButton}>
              <Animated.Text style={[styles.editTopicsArrow, { transform: [{ translateX: arrowAnim }] }]}>←</Animated.Text>
              <Text style={styles.editTopicsButtonText}>Edit Topics</Text>
            </Pressable>
          </View>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {isLoading ? (
          <View style={styles.centerState}>
            <ActivityIndicator color="#B8960C" />
            <Text style={styles.stateText}>Finding matching documents...</Text>
          </View>
        ) : error ? (
          <View style={styles.notice}>
            <Text style={styles.noticeTitle}>Connection issue</Text>
            <Text style={styles.noticeText}>{error}</Text>
          </View>
        ) : documents.length === 0 ? (
          <View style={styles.notice}>
            <Text style={styles.noticeTitle}>No matching document</Text>
            <Text style={styles.noticeText}>Try other topics from the knowledge base.</Text>
          </View>
        ) : (
          documents.map((doc) => {
            const matchedTopics: ColoredTopic[] = submittedTopics.flatMap((topic, i) => {
              const spans = doc.topicSpans[topic] ?? [];
              if (spans.length === 0) return [];
              const palette = TOPIC_COLORS[i % TOPIC_COLORS.length];
              return [{ text: topic, color: palette.bg, palette, spans }];
            });
            return (
              <DocumentCard
                key={doc.id}
                doc={doc}
                matchedTopics={matchedTopics}
                approvedKeys={approvedKeys}
                onApprove={handleApprove}
              />
            );
          })
        )}
      </ScrollView>
      {documents.length > 0 && (
        <View style={styles.confirmFooter}>
          <Pressable
            onPress={openApprovedTable}
            disabled={approvedRecords.length === 0}
            style={[
              styles.confirmButton,
              approvedRecords.length === 0 && styles.confirmButtonDisabled,
            ]}
          >
            <Text style={styles.confirmButtonText}>
              {'Confirm' + (approvedRecords.length > 0 ? ` (${approvedRecords.length})` : '')}
            </Text>
          </Pressable>
        </View>
      )}
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
  header: {
    backgroundColor: '#FFFDF7',
    borderBottomColor: '#F0E4A0',
    borderBottomWidth: 1,
    paddingHorizontal: 20,
    paddingBottom: 18,
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
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 16,
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
  selectedTopicsRow: {
    flexDirection: 'column',
    gap: 8,
  },
  selectedTopicsChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
  },
  topicChip: {
    backgroundColor: 'rgba(255, 140, 50, 0.07)',
    borderColor: 'rgba(255, 140, 50, 0.35)',
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  topicChipText: {
    color: '#172033',
    fontSize: 15,
    fontWeight: '600',
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
  selectedTopicLabel: {
    color: '#526071',
    fontSize: 13,
    textTransform: 'uppercase',
  },
  content: {
    padding: 20,
    paddingBottom: 40,
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
});
