import { useState } from "react";
import { ScrollView, TextInput, View } from "react-native";
import {
  C,
  Chip,
  Empty,
  Icon,
  InquiryCard,
  Screen,
  StateGate,
  T,
  s,
} from "../../components/ui";
import { useApp } from "../../state/AppState";
import { filterInquiries, type Status } from "../../domain";
export default function Inquiries() {
  const { records } = useApp();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<Status | "all">("all");
  const list = filterInquiries(records, { query, status });
  const filters: [Status | "all", string][] = [
    ["all", "All"],
    ["new", "New"],
    ["in_progress", "In progress"],
    ["waiting", "Waiting"],
    ["closed", "Closed"],
  ];
  return (
    <Screen title="Inquiries" subtitle="One view. Every next step.">
      <StateGate>
        <View style={[s.row, s.input, { paddingVertical: 0 }]}>
          <Icon name="search-outline" />
          <TextInput
            testID="inquiry-search"
            accessibilityLabel="Search inquiries"
            placeholder="Search name, need or contact"
            placeholderTextColor={C.muted}
            value={query}
            onChangeText={setQuery}
            style={{ flex: 1, color: C.text, fontSize: 16, minHeight: 52 }}
          />
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8 }}
        >
          {filters.map(([value, label]) => (
            <Chip
              key={value}
              title={label}
              selected={status === value}
              onPress={() => setStatus(value)}
            />
          ))}
        </ScrollView>
        <T style={{ color: C.muted, fontSize: 12, lineHeight: 19 }}>
          {list.length} of {records.length} sample inquiries in this view ·
          Latest first
        </T>
        {list.length ? (
          list.map((record) => (
            <InquiryCard key={record.inquiry.id} record={record} />
          ))
        ) : (
          <Empty
            title={
              query ? "No matching inquiries" : "No inquiries in this view"
            }
            detail={
              query
                ? "Try another name, service need or contact."
                : "Choose another filter or restore sample data in Settings."
            }
          />
        )}
      </StateGate>
    </Screen>
  );
}
