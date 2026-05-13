import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import {
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

type KnowledgeDocument = {
  id: string;
  title: string;
  content: string;
};

type DocumentsResponse = {
  topic: string;
  documents: KnowledgeDocument[];
};

type TopicResult = {
  topic: string;
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

function HighlightedText({ text, topics }: { text: string; topics: string[] }) {
  const normalizedTopics = topics.map((t) => t.trim().toLowerCase()).filter(Boolean);

  if (normalizedTopics.length === 0) {
    return <Text>{text}</Text>;
  }

  const lowerText = text.toLowerCase();
  const ranges: { start: number; end: number }[] = [];

  for (const normalizedTopic of normalizedTopics) {
    let idx = lowerText.indexOf(normalizedTopic);
    while (idx !== -1) {
      ranges.push({ start: idx, end: idx + normalizedTopic.length });
      idx = lowerText.indexOf(normalizedTopic, idx + 1);
    }
  }

  if (ranges.length === 0) {
    return <Text>{text}</Text>;
  }

  ranges.sort((a, b) => a.start - b.start);
  const merged: { start: number; end: number }[] = [];
  for (const range of ranges) {
    if (merged.length === 0 || range.start > merged[merged.length - 1].end) {
      merged.push({ ...range });
    } else {
      merged[merged.length - 1].end = Math.max(merged[merged.length - 1].end, range.end);
    }
  }

  const segments: { text: string; highlighted: boolean }[] = [];
  let cursor = 0;
  for (const { start, end } of merged) {
    if (start > cursor) segments.push({ text: text.slice(cursor, start), highlighted: false });
    segments.push({ text: text.slice(start, end), highlighted: true });
    cursor = end;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), highlighted: false });

  return (
    <Text>
      {segments.map((segment, index) => (
        <Text key={`${segment.text}-${index}`} style={segment.highlighted ? styles.highlight : undefined}>
          {segment.text}
        </Text>
      ))}
    </Text>
  );
}

type MergedDocument = {
  document: KnowledgeDocument;
  matchedTopics: string[];
};

function mergeDocumentResults(topicResults: TopicResult[]): MergedDocument[] {
  const seen = new Map<string, MergedDocument>();
  for (const result of topicResults) {
    for (const doc of result.documents) {
      if (seen.has(doc.id)) {
        seen.get(doc.id)!.matchedTopics.push(result.topic);
      } else {
        seen.set(doc.id, { document: doc, matchedTopics: [result.topic] });
      }
    }
  }
  return Array.from(seen.values());
}

export default function App() {
  const [topics, setTopics] = useState(['']);
  const [submittedTopics, setSubmittedTopics] = useState<string[]>([]);
  const [topicResults, setTopicResults] = useState<TopicResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

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
    setTopicResults([]);
    setError('');
  }

  useEffect(() => {
    if (submittedTopics.length === 0) {
      setTopicResults([]);
      setError('');
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError('');

    Promise.all(
      submittedTopics.map((topic) =>
        fetch(`${BACKEND_URL}/documents?topic=${encodeURIComponent(topic)}`)
          .then((response) => {
            if (!response.ok) {
              throw new Error('Could not load the knowledge base.');
            }

            return response.json() as Promise<DocumentsResponse>;
          })
          .then((data) => ({
            topic,
            documents: data.documents,
          }))
      )
    )
      .then(setTopicResults)
      .catch(() => {
        setTopicResults([]);
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
          <View style={styles.selectedTopicsText}>
            <Text style={styles.selectedTopicLabel}>Selected topics</Text>
            <Text style={styles.selectedTopic}>{submittedTopics.join(', ')}</Text>
          </View>
          <Pressable accessibilityLabel="Edit topics" onPress={editTopics} style={styles.editTopicsButton}>
            <Text style={styles.editTopicsButtonText}>Edit</Text>
          </Pressable>
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
        ) : mergeDocumentResults(topicResults).length === 0 ? (
          <View style={styles.notice}>
            <Text style={styles.noticeTitle}>No matching document</Text>
            <Text style={styles.noticeText}>Try other topics from the knowledge base.</Text>
          </View>
        ) : (
          mergeDocumentResults(topicResults).map(({ document, matchedTopics }) => (
            <View key={document.id} style={styles.document}>
              <Text style={styles.documentTitle}>
                <HighlightedText text={document.title} topics={matchedTopics} />
              </Text>

              {formatContent(getDocumentBody(document.content)).map((block, index) => (
                <Text
                  key={`${document.id}-${index}`}
                  style={block.kind === 'heading' ? styles.sectionHeading : styles.paragraph}
                >
                  <HighlightedText text={block.text} topics={matchedTopics} />
                </Text>
              ))}
            </View>
          ))
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
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
  },
  selectedTopicsText: {
    flex: 1,
  },
  editTopicsButton: {
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderColor: '#b7c1cf',
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 38,
    paddingHorizontal: 14,
  },
  editTopicsButtonText: {
    color: '#172033',
    fontSize: 15,
    fontWeight: '700',
  },
  selectedTopicLabel: {
    color: '#526071',
    fontSize: 13,
    marginBottom: 4,
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
  highlight: {
    backgroundColor: '#bbf7d0',
    color: '#111827',
  },
});
