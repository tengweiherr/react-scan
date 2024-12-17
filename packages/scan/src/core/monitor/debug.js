(function () {
  function getInteractionType(eventName) {
    if (['pointerdown', 'pointerup', 'click'].includes(eventName)) {
      return 'pointer';
    }
    if (['keydown', 'keyup'].includes(eventName)) {
      return 'keyboard';
    }
    return null;
  }

  function setupPerformanceListener(onEntry) {
    const longestInteractionMap = new Map();
    const interactionTargetMap = new Map();

    function processInteractionEntry(entry) {
      if (!(entry.interactionId || entry.entryType === 'first-input')) return;

      if (
        entry.interactionId &&
        entry.target &&
        !interactionTargetMap.has(entry.interactionId)
      ) {
        interactionTargetMap.set(entry.interactionId, entry.target);
      }

      const existingInteraction = longestInteractionMap.get(
        entry.interactionId,
      );

      if (existingInteraction) {
        if (entry.duration > existingInteraction.latency) {
          existingInteraction.entries = [entry];
          existingInteraction.latency = entry.duration;
        } else if (
          entry.duration === existingInteraction.latency &&
          entry.startTime === existingInteraction.entries[0].startTime
        ) {
          existingInteraction.entries.push(entry);
        }
      } else {
        const interactionType = getInteractionType(entry.name);
        if (!interactionType) return;

        const interaction = {
          id: entry.interactionId,
          latency: entry.duration,
          entries: [entry],
          target: entry.target,
          type: interactionType,
          startTime: entry.startTime,
          processingStart: entry.processingStart,
          processingEnd: entry.processingEnd,
          duration: entry.duration,
          inputDelay: entry.processingStart - entry.startTime,
          processingDuration: entry.processingEnd - entry.processingStart,
          presentationDelay:
            entry.duration - (entry.processingEnd - entry.startTime),
          timestamp: Date.now(),
        };
        longestInteractionMap.set(interaction.id, interaction);
        onEntry(interaction);
      }
    }

    const po = new PerformanceObserver((list) => {
      console.log('hi');

      const entries = list.getEntries();
      for (let i = 0; i < entries.length; i++) {
        processInteractionEntry(entries[i]);
      }
    });

    try {
      po.observe({
        type: 'event',
        durationThreshold: 16,
      });
      po.observe({
        type: 'first-input',
      });
    } catch (e) {
      console.warn(
        'PerformanceObserver "event" or "first-input" not supported:',
        e,
      );
    }

    return () => po.disconnect();
  }

  console.log('setup');

  const disconnectObserver = setupPerformanceListener((interaction) => {
    console.group('Performance Interaction');
    console.log('ID:', interaction.id);
    console.log('Type:', interaction.type);
    console.log('Duration:', interaction.duration);
    console.log('Latency:', interaction.latency);
    console.log('Start Time:', interaction.startTime);
    console.log('Processing Start:', interaction.processingStart);
    console.log('Processing End:', interaction.processingEnd);
    console.log('Input Delay:', interaction.inputDelay);
    console.log('Processing Duration:', interaction.processingDuration);
    console.log('Presentation Delay:', interaction.presentationDelay);
    console.log('Timestamp (logged):', interaction.timestamp);
    console.log('Target Element:', interaction.target);

    if (interaction.duration > 1000) {
      console.warn('Long interaction (>1s):', interaction);
    }

    if (interaction.entries && interaction.entries.length > 1) {
      console.log('All Entries:', interaction.entries);
    }
    console.groupEnd();
  });

  console.log(
    'Performance listener is active. Interactions will be logged to the console.',
  );
  console.log(
    'Call "stopPerformanceObserver()" in the console anytime to disconnect.',
  );

  window.stopPerformanceObserver = () => {
    disconnectObserver();
    console.log('Performance observer disconnected.');
  };
})();
