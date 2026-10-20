import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { PersonBalanceSummary, OverallBalanceSummary } from '@/utils/ledgerEngine';

interface LedgerCardProps {
  personSummary?: PersonBalanceSummary | null;
  overallSummary?: OverallBalanceSummary | null;
}

export const LedgerCard = React.memo(function LedgerCard({
  personSummary,
  overallSummary,
}: LedgerCardProps) {
  const colorScheme = useColorScheme() ?? 'dark';
  const theme = Colors[colorScheme];

  if (personSummary) {
    const isOwed = personSummary.netBalance > 0;
    const isDebt = personSummary.netBalance < 0;
    const isSettled = personSummary.netBalance === 0;

    const statusColor = isOwed
      ? theme.success
      : isDebt
        ? theme.error
        : theme.subtitle;

    const statusText = isOwed
      ? `${personSummary.person} owes you ₹${personSummary.netBalance}`
      : isDebt
        ? `You owe ${personSummary.person} ₹${Math.abs(personSummary.netBalance)}`
        : `All dues settled with ${personSummary.person}`;

    return (
      <View style={[styles.card, { backgroundColor: theme.surface, borderColor: statusColor + '50' }]}>
        {/* Header */}
        <View style={styles.cardHeader}>
          <View style={[styles.avatarCircle, { backgroundColor: statusColor + '20' }]}>
            <Text style={[styles.avatarText, { color: statusColor }]}>
              {personSummary.person.charAt(0).toUpperCase()}
            </Text>
          </View>
          <View style={styles.headerInfo}>
            <Text style={[styles.personName, { color: theme.text }]}>
              {personSummary.person}
            </Text>
            <Text style={[styles.statusSubtext, { color: statusColor }]}>
              {statusText}
            </Text>
          </View>
          <View style={[styles.badge, { backgroundColor: statusColor + '20' }]}>
            <Text style={[styles.badgeText, { color: statusColor }]}>
              {isOwed ? 'RECEIVABLE' : isDebt ? 'PAYABLE' : 'SETTLED'}
            </Text>
          </View>
        </View>

        {/* Breakdown Row */}
        <View style={[styles.statsRow, { borderTopColor: theme.border, borderBottomColor: theme.border }]}>
          <View style={styles.statBox}>
            <Text style={[styles.statLabel, { color: theme.subtitle }]}>You Lent / Paid</Text>
            <Text style={[styles.statValue, { color: theme.text }]}>₹{personSummary.totalGave}</Text>
          </View>
          <View style={[styles.divider, { backgroundColor: theme.border }]} />
          <View style={styles.statBox}>
            <Text style={[styles.statLabel, { color: theme.subtitle }]}>You Received</Text>
            <Text style={[styles.statValue, { color: theme.text }]}>₹{personSummary.totalReceived}</Text>
          </View>
          <View style={[styles.divider, { backgroundColor: theme.border }]} />
          <View style={styles.statBox}>
            <Text style={[styles.statLabel, { color: theme.subtitle }]}>Net Balance</Text>
            <Text style={[styles.statValue, { color: statusColor }]}>
              {isDebt ? `-₹${Math.abs(personSummary.netBalance)}` : `₹${personSummary.netBalance}`}
            </Text>
          </View>
        </View>

        {/* Contributing Notes */}
        {personSummary.transactions.length > 0 && (
          <View style={styles.txList}>
            <Text style={[styles.txTitle, { color: theme.subtitle }]}>
              Transaction Ledger ({personSummary.transactions.length})
            </Text>
            {personSummary.transactions.map((tx, idx) => (
              <View key={tx.id || idx} style={styles.txRow}>
                <Text style={[styles.txDot, { color: tx.direction === 'GAVE' ? theme.accent : theme.success }]}>
                  {tx.direction === 'GAVE' ? '↗ Lent' : '↙ Received'}
                </Text>
                <Text numberOfLines={1} style={[styles.txContent, { color: theme.text }]}>
                  {tx.note_content || `₹${tx.amount}`}
                </Text>
                <Text style={[styles.txAmount, { color: tx.direction === 'GAVE' ? theme.accent : theme.success }]}>
                  {tx.direction === 'GAVE' ? `+₹${tx.amount}` : `-₹${tx.amount}`}
                </Text>
              </View>
            ))}
          </View>
        )}
      </View>
    );
  }

  if (overallSummary) {
    const isNetPositive = overallSummary.netBalance > 0;
    const isNetNegative = overallSummary.netBalance < 0;
    const netColor = isNetPositive
      ? theme.success
      : isNetNegative
        ? theme.error
        : theme.subtitle;

    return (
      <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <View style={styles.cardHeader}>
          <Text style={[styles.personName, { color: theme.text }]}>
            📊 Overall Debt Summary
          </Text>
          <View style={[styles.badge, { backgroundColor: netColor + '20' }]}>
            <Text style={[styles.badgeText, { color: netColor }]}>
              Net: {isNetNegative ? `-₹${Math.abs(overallSummary.netBalance)}` : `₹${overallSummary.netBalance}`}
            </Text>
          </View>
        </View>

        <View style={[styles.statsRow, { borderTopColor: theme.border, borderBottomColor: theme.border }]}>
          <View style={styles.statBox}>
            <Text style={[styles.statLabel, { color: theme.subtitle }]}>People Owe You</Text>
            <Text style={[styles.statValue, { color: theme.success }]}>₹{overallSummary.totalOwedToUser}</Text>
          </View>
          <View style={[styles.divider, { backgroundColor: theme.border }]} />
          <View style={styles.statBox}>
            <Text style={[styles.statLabel, { color: theme.subtitle }]}>You Owe People</Text>
            <Text style={[styles.statValue, { color: theme.error }]}>₹{overallSummary.totalUserOwes}</Text>
          </View>
        </View>

        {/* Creditors */}
        {overallSummary.creditors.length > 0 && (
          <View style={styles.txList}>
            <Text style={[styles.txTitle, { color: theme.success }]}>Owes You Money:</Text>
            {overallSummary.creditors.map((c, i) => (
              <View key={i} style={styles.txRow}>
                <Text style={[styles.txContent, { color: theme.text }]}>• {c.person}</Text>
                <Text style={[styles.txAmount, { color: theme.success }]}>₹{c.amountOwedToUser}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Debtors */}
        {overallSummary.debtors.length > 0 && (
          <View style={styles.txList}>
            <Text style={[styles.txTitle, { color: theme.error }]}>You Need to Pay:</Text>
            {overallSummary.debtors.map((d, i) => (
              <View key={i} style={styles.txRow}>
                <Text style={[styles.txContent, { color: theme.text }]}>• {d.person}</Text>
                <Text style={[styles.txAmount, { color: theme.error }]}>₹{d.amountUserOwes}</Text>
              </View>
            ))}
          </View>
        )}
      </View>
    );
  }

  return null;
});

const styles = StyleSheet.create({
  card: {
    borderRadius: 14,
    borderWidth: 1.5,
    marginVertical: 8,
    padding: 14,
    width: '100%',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  avatarCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  avatarText: {
    fontSize: 16,
    fontWeight: '700',
  },
  headerInfo: {
    flex: 1,
  },
  personName: {
    fontSize: 16,
    fontWeight: '700',
  },
  statusSubtext: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  statsRow: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderBottomWidth: 1,
    paddingVertical: 10,
    marginVertical: 6,
    justifyContent: 'space-around',
    alignItems: 'center',
  },
  statBox: {
    alignItems: 'center',
    flex: 1,
  },
  statLabel: {
    fontSize: 10,
    fontWeight: '600',
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  statValue: {
    fontSize: 14,
    fontWeight: '700',
  },
  divider: {
    width: 1,
    height: 24,
  },
  txList: {
    marginTop: 8,
  },
  txTitle: {
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  txRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  txDot: {
    fontSize: 11,
    fontWeight: '600',
    width: 75,
  },
  txContent: {
    fontSize: 12,
    flex: 1,
    marginHorizontal: 8,
  },
  txAmount: {
    fontSize: 12,
    fontWeight: '700',
  },
});
