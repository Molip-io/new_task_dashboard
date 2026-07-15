const REQUIRED_PROPERTIES = [
  ['작업', ['작업', '이름', 'Name']],
  ['상태', ['Status', '상태']],
  ['팀', ['팀']],
  ['담당자', ['담당자']],
  ['상위 항목', ['상위 항목', '부모 항목', 'Parent item']],
  ['기간', ['시작날짜 <-> Dead Line', '기간', '날짜']],
  ['완료일', ['완료일', '완료 날짜', '완료일자']],
  ['프로젝트', ['프로젝트']],
  ['스프린트', ['스프린트', 'Sprint']],
];

export function inspectWorkDatabaseSetup(databases) {
  const inspected = databases.map(database => {
    const propertyNames = Object.keys(database.properties || {});
    const missingProperties = REQUIRED_PROPERTIES
      .filter(([, aliases]) => !aliases.some(alias => propertyNames.includes(alias)))
      .map(([label]) => label);
    return {
      id: database.id,
      title: database.title,
      propertyNames,
      missingProperties,
      ready: missingProperties.length === 0,
    };
  });
  return {
    ready: inspected.length > 0 && inspected.every(database => database.ready),
    databases: inspected,
  };
}
