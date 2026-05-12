import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
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

type ContentBlock = {
  kind: 'heading' | 'paragraph';
  text: string;
};

const BACKEND_URL =
  Platform.OS === 'android' ? 'http://10.0.2.2:8000' : 'http://localhost:8000';

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

function HighlightedText({ text, topic }: { text: string; topic: string }) {
  const normalizedTopic = topic.trim().toLowerCase();

  if (!normalizedTopic) {
    return <Text>{text}</Text>;
  }

  const segments = [];
  const lowerText = text.toLowerCase();
  let cursor = 0;
  let matchIndex = lowerText.indexOf(normalizedTopic);

  while (matchIndex !== -1) {
    if (matchIndex > cursor) {
      segments.push({ text: text.slice(cursor, matchIndex), highlighted: false });
    }

    const matchEnd = matchIndex + normalizedTopic.length;
    segments.push({ text: text.slice(matchIndex, matchEnd), highlighted: true });
    cursor = matchEnd;
    matchIndex = lowerText.indexOf(normalizedTopic, cursor);
  }

  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), highlighted: false });
  }

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

export default function App() {
  const [topic, setTopic] = useState('');
  const [submittedTopic, setSubmittedTopic] = useState('');
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const canSubmit = topic.trim().length > 0;

  function submitTopic() {
    const nextTopic = topic.trim();

    if (!nextTopic) {
      return;
    }

    setSubmittedTopic(nextTopic);
  }

  useEffect(() => {
    if (!submittedTopic) {
      setDocuments([]);
      setError('');
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError('');

    fetch(`${BACKEND_URL}/documents?topic=${encodeURIComponent(submittedTopic)}`)
      .then((response) => {
        if (!response.ok) {
          throw new Error('Could not load the knowledge base.');
        }

        return response.json() as Promise<DocumentsResponse>;
      })
      .then((data) => setDocuments(data.documents))
      .catch(() => {
        setDocuments([]);
        setError('Could not reach the backend at http://localhost:8000. Start FastAPI and try again.');
      })
      .finally(() => setIsLoading(false));
  }, [submittedTopic]);

  if (!submittedTopic) {
    return (
      <SafeAreaView style={styles.screen}>
        <StatusBar style="dark" />
        <View style={styles.startContainer}>
          <Text style={styles.brand}>GroundLens</Text>
          <Text style={styles.startPrompt}>Type a topic to search the knowledge base</Text>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setTopic}
            onSubmitEditing={submitTopic}
            placeholder="Create targeted campaigns for Facebook"
            placeholderTextColor="#78818f"
            returnKeyType="search"
            style={styles.input}
            value={topic}
          />
          <Pressable
            disabled={!canSubmit}
            onPress={submitTopic}
            style={[styles.submitButton, !canSubmit && styles.submitButtonDisabled]}
          >
            <Text style={styles.submitButtonText}>Submit</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <Text style={styles.brand}>GroundLens</Text>
        <Text style={styles.selectedTopicLabel}>Selected topic</Text>
        <Text style={styles.selectedTopic}>{submittedTopic}</Text>
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
            <Text style={styles.noticeText}>Try another topic from the knowledge base.</Text>
          </View>
        ) : (
          documents.map((document) => (
            <View key={document.id} style={styles.document}>
              <Text style={styles.documentTitle}>
                <HighlightedText text={document.title} topic={submittedTopic} />
              </Text>

              {formatContent(getDocumentBody(document.content)).map((block, index) => {
                return (
                  <Text
                    key={`${document.id}-${index}`}
                    style={block.kind === 'heading' ? styles.sectionHeading : styles.paragraph}
                  >
                    <HighlightedText text={block.text} topic={submittedTopic} />
                  </Text>
                );
              })}
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
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  header: {
    backgroundColor: '#ffffff',
    borderBottomColor: '#dde3ec',
    borderBottomWidth: 1,
    paddingHorizontal: 20,
    paddingBottom: 18,
    paddingTop: 14,
  },
  brand: {
    color: '#172033',
    fontSize: 28,
    fontWeight: '800',
    marginBottom: 14,
  },
  startPrompt: {
    color: '#526071',
    fontSize: 17,
    lineHeight: 24,
    marginBottom: 18,
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
  },
  submitButton: {
    alignItems: 'center',
    backgroundColor: '#2563eb',
    borderRadius: 8,
    justifyContent: 'center',
    marginTop: 12,
    minHeight: 48,
  },
  submitButtonDisabled: {
    backgroundColor: '#aeb8c6',
  },
  submitButtonText: {
    color: '#ffffff',
    fontSize: 16,
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
