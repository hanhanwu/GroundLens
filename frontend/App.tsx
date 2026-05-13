import { StatusBar } from 'expo-status-bar';
import { Fragment, useEffect, useRef, useState } from 'react';
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
  { bg: 'rgba(255, 140, 50, 0.15)',  border: 'rgba(255, 140, 50, 0.45)',  text: '#7a3a00' },
  { bg: 'rgba(99,  102, 241, 0.12)', border: 'rgba(99,  102, 241, 0.40)', text: '#2d2d80' },
  { bg: 'rgba(16,  185, 129, 0.12)', border: 'rgba(16,  185, 129, 0.40)', text: '#065f46' },
  { bg: 'rgba(236,  72, 153, 0.12)', border: 'rgba(236,  72, 153, 0.40)', text: '#7c1252' },
  { bg: 'rgba(234, 179,   8, 0.13)', border: 'rgba(234, 179,   8, 0.42)', text: '#6b4c00' },
  { bg: 'rgba(59,  130, 246, 0.12)', border: 'rgba(59,  130, 246, 0.40)', text: '#1e3a6e' },
];

type ColoredTopic = { text: string; color: string; spans: string[] };

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

type LayoutRect = { y: number; height: number };

function DocumentCard({
  doc,
  matchedTopics,
}: {
  doc: KnowledgeDocument;
  matchedTopics: ColoredTopic[];
}) {
  const [blockLayouts, setBlockLayouts] = useState<Record<number, LayoutRect>>({});
  const [qaLayouts, setQaLayouts] = useState<Record<number, LayoutRect>>({});
  const [leftColumnWidth, setLeftColumnWidth] = useState(0);

  const bodyBlocks = formatContent(getDocumentBody(doc.content));
  const qaPairs = doc.qaPairs ?? [];

  // Map each QA index to the first body block whose text contains its span
  const spanToBlockIndex: Record<number, number> = {};
  qaPairs.forEach((qa, qaIndex) => {
    const blockIndex = bodyBlocks.findIndex((b) => b.text.includes(qa.span));
    if (blockIndex !== -1) spanToBlockIndex[qaIndex] = blockIndex;
  });

  const CONN_COLOR = '#94a3b8';
  const ARM_LEFT = 12;
  const ARM_RIGHT = 16;

  const connectors = qaPairs.map((_, qaIndex) => {
    const blockIndex = spanToBlockIndex[qaIndex];
    if (blockIndex === undefined) return null;
    const bl = blockLayouts[blockIndex];
    const ql = qaLayouts[qaIndex];
    if (!bl || !ql || leftColumnWidth === 0) return null;
    return {
      fromY: bl.y + bl.height / 2,
      toY: ql.y + ql.height / 2,
    };
  });

  const hasQA = qaPairs.length > 0;

  return (
    <View style={styles.document}>
      <Text style={styles.documentTitle}>
        <HighlightedText text={doc.title} topics={matchedTopics} />
      </Text>
      <View style={{ flexDirection: 'row' }}>
        {/* Left column: document body */}
        <View
          style={hasQA ? styles.docLeft : { flex: 1 }}
          onLayout={(e) => setLeftColumnWidth(e.nativeEvent.layout.width)}
        >
          {bodyBlocks.map((block, index) => (
            <View
              key={`${doc.id}-b${index}`}
              onLayout={(e) =>
                setBlockLayouts((prev) => ({
                  ...prev,
                  [index]: { y: e.nativeEvent.layout.y, height: e.nativeEvent.layout.height },
                }))
              }
            >
              <Text style={block.kind === 'heading' ? styles.sectionHeading : styles.paragraph}>
                <HighlightedText text={block.text} topics={matchedTopics} />
              </Text>
            </View>
          ))}
        </View>

        {/* Right column: Q&A cards */}
        {hasQA && (
          <View style={styles.qaColumn}>
            {qaPairs.map((qa, index) => (
              <View
                key={`${doc.id}-qa${index}`}
                style={styles.qaCard}
                onLayout={(e) =>
                  setQaLayouts((prev) => ({
                    ...prev,
                    [index]: { y: e.nativeEvent.layout.y, height: e.nativeEvent.layout.height },
                  }))
                }
              >
                <Text style={styles.qaQuestion}>{qa.question}</Text>
                <Text style={styles.qaAnswer}>{qa.answer}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Dashed connecting lines overlay */}
        {hasQA && (
          <View pointerEvents="none" style={StyleSheet.absoluteFillObject}>
            {connectors.map((conn, i) => {
              if (!conn) return null;
              const { fromY, toY } = conn;
              return (
                <Fragment key={i}>
                  {/* Left arm: horizontal dashes from doc text to column boundary */}
                  <View
                    style={{
                      position: 'absolute',
                      left: leftColumnWidth - ARM_LEFT,
                      top: fromY,
                      width: ARM_LEFT,
                      height: 0,
                      borderTopWidth: 1.5,
                      borderColor: CONN_COLOR,
                      borderStyle: 'dashed',
                    }}
                  />
                  {/* Vertical bridge between the two Y positions */}
                  {Math.abs(fromY - toY) > 2 && (
                    <View
                      style={{
                        position: 'absolute',
                        left: leftColumnWidth - 0.75,
                        top: Math.min(fromY, toY),
                        width: 0,
                        height: Math.abs(toY - fromY),
                        borderLeftWidth: 1.5,
                        borderLeftColor: CONN_COLOR,
                        borderStyle: 'dashed',
                      }}
                    />
                  )}
                  {/* Right arm: horizontal dashes into Q&A column */}
                  <View
                    style={{
                      position: 'absolute',
                      left: leftColumnWidth,
                      top: toY,
                      width: ARM_RIGHT,
                      height: 0,
                      borderTopWidth: 1.5,
                      borderColor: CONN_COLOR,
                      borderStyle: 'dashed',
                    }}
                  />
                </Fragment>
              );
            })}
          </View>
        )}
      </View>
    </View>
  );
}

export default function App() {
  const [topics, setTopics] = useState(['']);
  const [submittedTopics, setSubmittedTopics] = useState<string[]>([]);
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const arrowAnim = useRef(new Animated.Value(0)).current;

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

  const canSubmit = topics.some((topic) => topic.trim().length > 0);

  function updateTopic(index: number, text: string) {
    setTopics((currentTopics) => {
      const nextTopics = [...currentTopics];
      nextTopics[index] = text;
      return nextTopics;
    });
  }

  function addTopic(insertAfterIndex?: number) {
    setTopics((currentTopics) => {
      const next = [...currentTopics];
      if (typeof insertAfterIndex === 'number') {
        next.splice(insertAfterIndex + 1, 0, '');
      } else {
        next.push('');
      }
      return next;
    });
  }

  function submitTopic() {
    const nextTopics = topics
      .map((topic) => topic.trim())
      .filter(Boolean);

    if (nextTopics.length === 0) {
      return;
    }

    setSubmittedTopics(nextTopics);
  }

  function editTopics() {
    setSubmittedTopics([]);
    setDocuments([]);
    setError('');
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

  if (submittedTopics.length === 0) {
    return (
      <SafeAreaView style={styles.screen}>
        <StatusBar style="dark" />
        <View style={styles.topBar}>
          <BrandLogo />
        </View>
        <ScrollView contentContainerStyle={styles.startContainer} keyboardShouldPersistTaps="handled">
          {topics.map((topic, index) => (
            <View key={index} style={styles.topicGroup}>
              <View style={styles.topicRow}>
                <Text style={styles.topicLabel}>Topic {index + 1}</Text>
                <TextInput
                  autoCapitalize="none"
                  autoCorrect={false}
                  onChangeText={(text) => updateTopic(index, text)}
                  onSubmitEditing={submitTopic}
                  placeholder="Create targeted campaigns for Facebook"
                  placeholderTextColor="#78818f"
                  returnKeyType="search"
                  style={styles.input}
                  value={topic}
                />
                <Pressable
                  accessibilityLabel="Add topic"
                  onPress={() => addTopic(index)}
                  style={[styles.addIconButton, index !== topics.length - 1 && { opacity: 0 }]}
                  disabled={index !== topics.length - 1}
                  pointerEvents={index !== topics.length - 1 ? 'none' : 'auto'}
                >
                  <Text style={styles.addIconText}>+</Text>
                </Pressable>
              </View>
            </View>
          ))}
          <View style={styles.actionRow}>
            <Pressable
              disabled={!canSubmit}
              onPress={submitTopic}
              style={[styles.submitButton, !canSubmit && styles.submitButtonDisabled]}
            >
              <Text style={styles.submitButtonText}>Submit</Text>
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
            <ActivityIndicator color="#2563eb" />
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
              return [{ text: topic, color: TOPIC_COLORS[i % TOPIC_COLORS.length].bg, spans }];
            });
            return <DocumentCard key={doc.id} doc={doc} matchedTopics={matchedTopics} />;
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#f6f8fb',
  },
  startContainer: {
    alignItems: 'center',
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 24,
  },
  topBar: {
    alignItems: 'flex-start',
    paddingHorizontal: 20,
    paddingTop: 14,
  },
  header: {
    backgroundColor: '#ffffff',
    borderBottomColor: '#dde3ec',
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
  startPrompt: {
    color: '#526071',
    fontSize: 17,
    lineHeight: 24,
    marginBottom: 18,
  },
  topicGroup: {
    maxWidth: 520,
    marginBottom: 14,
    width: '100%',
    alignSelf: 'center',
  },
  topicRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
  },
  topicLabel: {
    color: '#172033',
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 8,
    marginRight: 6,
  },
  input: {
    backgroundColor: '#ffffff',
    borderColor: '#b7c1cf',
    borderRadius: 8,
    borderWidth: 1,
    color: '#172033',
    fontSize: 17,
    minHeight: 48,
    paddingHorizontal: 14,
    flex: 1,
    minWidth: 0,
    maxWidth: '100%',
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
  addButton: {
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderColor: '#b7c1cf',
    borderRadius: 8,
    borderWidth: 1,
    height: 42,
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  addIconButton: {
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderColor: '#b7c1cf',
    borderRadius: 8,
    borderWidth: 1,
    height: 42,
    justifyContent: 'center',
    paddingHorizontal: 12,
    marginLeft: 8,
  },
  addIconText: {
    color: '#172033',
    fontSize: 20,
    fontWeight: '700',
  },
  addButtonText: {
    color: '#172033',
    fontSize: 15,
    fontWeight: '700',
  },
  submitButton: {
    alignItems: 'center',
    backgroundColor: '#2563eb',
    borderRadius: 8,
    justifyContent: 'center',
    minHeight: 42,
    paddingHorizontal: 22,
  },
  submitButtonDisabled: {
    backgroundColor: '#aeb8c6',
  },
  submitButtonText: {
    color: '#ffffff',
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
  selectedTopic: {
    color: '#172033',
    fontSize: 18,
    lineHeight: 25,
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
    borderColor: '#dde3ec',
    borderRadius: 8,
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
  topicResult: {
    gap: 14,
    marginBottom: 22,
  },
  topicResultTitle: {
    color: '#172033',
    fontSize: 20,
    fontWeight: '800',
    lineHeight: 28,
  },
  document: {
    backgroundColor: '#ffffff',
    borderColor: '#dde3ec',
    borderRadius: 8,
    borderWidth: 1,
    padding: 20,
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
  docLeft: {
    flex: 6,
    paddingRight: 12,
  },
  qaColumn: {
    flex: 4,
    paddingLeft: 16,
    gap: 12,
  },
  qaCard: {
    backgroundColor: '#f0f4ff',
    borderColor: '#c7d3ea',
    borderLeftColor: '#6366f1',
    borderRadius: 8,
    borderWidth: 1,
    borderLeftWidth: 3,
    padding: 12,
  },
  qaQuestion: {
    color: '#1e3a5f',
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 18,
    marginBottom: 5,
  },
  qaAnswer: {
    color: '#374151',
    fontSize: 12,
    lineHeight: 17,
  },
  highlight: {
    color: '#111827',
  },
});
